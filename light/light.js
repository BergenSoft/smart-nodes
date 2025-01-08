module.exports = function (RED)
{
    "use strict";

    function LightControlNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        // ###################
        // # Class constants #
        // ###################


        // #######################
        // # Global help objects #
        // #######################
        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");


        // ############################
        // # Used from text-exec node #
        // ############################
        if (typeof config.exec_text_names == "string")
            node.exec_text_names = config.exec_text_names.split(",").map(n => n.trim().toLowerCase());
        else
            node.exec_text_names = [];


        // #####################
        // # persistent values #
        // #####################
        var node_settings = helper.cloneObject({
            last_value: false,
            last_value_before_alarm: false,
            last_value_sended: false,
            alarm_active: false,
        }, smart_context.get(node.id));


        // ##################
        // # Dynamic config #
        // ##################
        let max_time_on = helper.getTimeInMs(config.max_time_on, config.max_time_on_unit);
        let alarm_action = config.alarm_action || "NOTHING";
        let alarm_off_action = config.alarm_off_action || "NOTHING";
        let data_type = config.data_type || "SIMPLE";

        // ##################
        // # Runtime values #
        // ##################

        // Here the setTimeout return value is stored to turn off the light.
        // That means if it is null, the light will not be turned off automatically.
        let timeout = null;

        // If isPermanent is true, then a default on time value is ignored
        // Also if the motion sensor turns off, no timeout is started.
        let isPermanent = false;

        // If this is on, a motion sensor has detected a move, so the on time value is ignored.
        // The timeout starts only if the motion sensor goes off.
        let isMotion = false;

        // If this is on, ignore all state changes and don't restart any time measurement.
        let isBlinking = false;

        // Here the date is stored, when the light should go off.
        // This is used to calculate the node status.
        let timeout_end_date = null;


        // #########################
        // # Central node handling #
        // #########################
        var event = "node:" + node.id;
        var handler = function (msg)
        {
            node.receive(msg);
        }
        RED.events.on(event, handler);


        // ###############
        // # Node events #
        // ###############
        node.on("input", function (msg)
        {
            handleTopic(msg);

            setStatus();
            smart_context.set(node.id, node_settings);
        });

        node.on("close", function ()
        {
            stopAutoOff();
            RED.events.off(event, handler);
        });


        // #####################
        // # Private functions #
        // #####################

        // This is the main function which handles all topics that was received.
        let handleTopic = msg =>
        {
            let doRestartTimer = true;
            let real_topic = helper.getTopicName(msg.topic);

            switch (real_topic)
            {
                case "status":
                    // Ignore if it is in blinking mode
                    if (isBlinking)
                        return;

                    // Make sure it is bool
                    msg.payload = !!msg.payload;

                    // Output is already in the state of the status value and the timeout is running.
                    // No need to restart the timeout.
                    if (node_settings.last_value == msg.payload && timeout != null)
                        doRestartTimer = false;

                    node_settings.last_value = msg.payload;
                    break;

                case "off":
                    // If button is released, don't handle this message
                    if (msg.payload === false)
                        return;

                    node_settings.last_value = false;
                    node_settings.last_value_sended = node_settings.last_value;
                    break;

                case "on":
                    // If button is released, don't handle this message
                    if (msg.payload === false)
                        return;

                    node_settings.last_value = true;
                    node_settings.last_value_sended = node_settings.last_value;
                    break;

                case "set":
                    // Make sure it is bool
                    msg.payload = !!msg.payload;

                    node_settings.last_value = msg.payload;
                    node_settings.last_value_sended = node_settings.last_value;
                    break;

                case "set_permanent":
                    // Make sure it is bool
                    msg.payload = !!msg.payload;
                    isPermanent = msg.payload;

                    node_settings.last_value = msg.payload;
                    node_settings.last_value_sended = node_settings.last_value;
                    break;

                case "motion":
                    // Make sure it is bool
                    msg.payload = !!msg.payload;
                    isMotion = msg.payload;

                    if (msg.payload == false)
                    {
                        // It already was off, so don't turn on
                        if (node_settings.last_value == false)
                            return;

                        // If time is set to 0, then turn off immediately
                        if (helper.getTimeInMsFromString(msg.time_on ?? max_time_on) == 0)
                            node_settings.last_value = false;
                    }
                    else
                    {
                        node_settings.last_value = true;
                    }
                    node_settings.last_value_sended = node_settings.last_value;
                    break;

                case "alarm":
                    // Make sure it is bool
                    msg.payload = !!msg.payload;

                    // No alarm change, do nothing
                    if (node_settings.alarm_active == msg.payload)
                        return;

                    node_settings.alarm_active = msg.payload;
                    if (node_settings.alarm_active)
                    {
                        // Alarm turned on
                        node_settings.last_value_before_alarm = node_settings.last_value;
                    }
                    else
                    {
                        // Alarm turned off
                        switch (alarm_off_action)
                        {
                            case "NOTHING":
                                break;

                            case "ON":
                                node_settings.last_value = true;
                                break;

                            case "OFF":
                                node_settings.last_value = false;
                                break;

                            case "LAST":
                                node_settings.last_value = node_settings.last_value_before_alarm;
                                break;

                            case "LAST_SENDED":
                                node_settings.last_value = node_settings.last_value_sended;
                                break;
                        }
                    }

                    break;

                case "blink":
                    if (!node_settings.alarm_active)
                    {
                        isBlinking = true;
                        sendState(!node_settings.last_value)
                        setStatus();
                        setTimeout(
                            () =>
                            {
                                isBlinking = false;
                                if (!node_settings.alarm_active)
                                {
                                    sendState(node_settings.last_value)
                                    setStatus();
                                }
                            },
                            helper.getTimeInMsFromString(msg.time_on, 500)
                        );
                    }
                    return;

                case "toggle":
                default:
                    // If button is released, don't handle this message
                    if (msg.payload === false)
                        return;

                    node_settings.last_value = !node_settings.last_value;
                    node_settings.last_value_sended = node_settings.last_value;
                    break;
            }

            if (doRestartTimer)
                stopAutoOff();

            // Check alarm values
            if (node_settings.alarm_active)
            {
                isPermanent = false;

                switch (alarm_action)
                {
                    case "ON":
                        node_settings.last_value = true;
                        break;

                    case "OFF":
                        node_settings.last_value = false;
                        break;

                    case "NOTHING":
                    default:
                        break;
                }
            }

            if (node_settings.alarm_active || helper.getTopicName(msg.topic) != "status")
                sendState(node_settings.last_value)

            // Output is on, now
            if (node_settings.last_value && doRestartTimer)
                startAutoOffIfNeeded(helper.getTimeInMsFromString(msg.time_on ?? max_time_on));

            notifyCentral(node_settings.last_value);
        }


        /**
         * This function sets a timeout to turn off the light after the defined time is over.
         * @param {*} origTimeMs The on time
         */
        let startAutoOffIfNeeded = origTimeMs =>
        {
            // No timer when alarm is active
            if (node_settings.alarm_active)
                return;

            let timeMs = parseInt(origTimeMs);

            if (isNaN(timeMs))
            {
                helper.warn(this, "Invalid time_on value send: " + origTimeMs);
                timeMs = max_time_on;
            }

            // calculate end date for status message
            timeout_end_date = new Date();
            timeout_end_date.setMilliseconds(timeout_end_date.getMilliseconds() + timeMs);

            // Stop if any timeout is set
            stopAutoOff();

            // 0 = Always on
            if (timeMs <= 0 || isPermanent || isMotion || !node_settings.last_value)
                return;

            timeout = setTimeout(() =>
            {
                timeout = null;
                node_settings.last_value = false;
                sendTurnOff();
                notifyCentral(false);

                setStatus();
                smart_context.set(node.id, node_settings);
            }, timeMs);
        };

        /**
         * Stops the current running timeout
         */
        let stopAutoOff = () =>
        {
            if (timeout != null)
            {
                clearTimeout(timeout);
                timeout = null;
            }
        };

        /**
         * Set the current node status
         */
        let setStatus = () =>
        {
            if (node_settings.alarm_active)
            {
                node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": ALARM is active" });
            }
            else if (isBlinking)
            {
                node.status({ fill: "yellow", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Blink" });
            }
            else if (node_settings.last_value)
            {
                if (isPermanent || isMotion || timeout == null)
                    node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": On" });
                else if (timeout)
                    node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": Wait " + helper.formatDateToStatus(timeout_end_date, "until") + " for auto off" });
            }
            else
            {
                node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Off" });
            }
        }

        /**
         * Turns the output to the given state and returns the sent message
         * @param {bool} state The new state of the output
         * @returns The sent message
         */
        let sendState = state =>
        {
            if (state)
                return sendTurnOn();

            return sendTurnOff();
        }

        /**
         * Turns the output on and returns the sent message
         * @returns The sent message
         */
        let sendTurnOn = () =>
        {
            let data = null;
            switch (data_type)
            {
                case "SIMPLE":
                    data = { payload: true };
                    break;

                case "HOMEASSISTANT":
                    data = { payload: { action: "homeassistant.turn_on" } };
                    break;

                default:
                    return null;
            }
            node.send(data);
            return data;
        }

        /**
         * Turns the output off and returns the sent message
         * @returns The sent message
         */
        let sendTurnOff = () =>
        {
            let data = null;
            switch (data_type)
            {
                case "SIMPLE":
                    data = { payload: false };
                    break;

                case "HOMEASSISTANT":
                    data = { payload: { action: "homeassistant.turn_off" } };
                    break;

                default:
                    return null;
            }
            node.send(data);
            return data;
        }

        /**
         * Notify all connected central nodes
         * @param {boolean} state The state if the light is on
         */
        let notifyCentral = state =>
        {
            if (!config.links)
                return;

            config.links.forEach(link =>
            {
                helper.log(node.id + " -> " + link);
                helper.log({ source: node.id, state: state });
                RED.events.emit("node:" + link, { source: node.id, state: state });
            });
        }

        // After node red restart, start also the timeout
        if (node_settings.last_value)
            startAutoOffIfNeeded(helper.getTimeInMsFromString(max_time_on));

        setStatus();
    }

    RED.nodes.registerType("smart_light-control", LightControlNode);
};