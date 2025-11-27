module.exports = function (RED)
{
    "use strict";

    function ShutterComplexControlNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        // ###################
        // # Class constants #
        // ###################
        const ACTION_UP = 0;
        const ACTION_DOWN = 1;
        const ACTION_STOP = 2;
        const ACTION_POSITION = 3;

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
            last_position: 0,              // 0 = opened, 100 = closed
            last_direction_up: true,       // remember last direction for toggle action
            last_position_before_alarm: 0, // remember position to restore on alarm off event
            alarm_active: false,           // remember if alarm is on or off
            config_change_date: config.config_change_date,
        }, smart_context.get(node.id, config.config_change_date));


        // ##########################
        // # Backward compatibility #
        // ##########################
        if (typeof config.max_time != "undefined")
        {
            config.max_time_up = config.max_time;
            config.max_time_down = config.max_time;
            delete config.max_time;
        }


        // ##################
        // # Dynamic config #
        // ##################
        let max_time_up = parseInt(config.max_time_up || 60, 10);
        let max_time_down = parseInt(config.max_time_down || 60, 10);
        let revert_time_ms = parseInt(config.revert_time_ms || 100, 10);
        let alarm_action = config.alarm_action || "NOTHING";
        let alarm_off_action = config.alarm_off_action || "NOTHING";


        // ##################
        // # Runtime values #
        // ##################

        // Here the setTimeout return value is stored to stop the shutter.
        // That means if it is null, the shutter is stopped.
        let timeout = null;

        // The local time when the shutter starts moving.
        // This is needed to calc the new position of the shutter.
        let on_time = null;

        // The local time when the shutter was stopped last time.
        // This is used to measure the revert time.
        let off_time = null;

        // This is the return value of setTimeout when the shutter has to wait until the reverse time is finished.
        let wait_timeout = null;


        // #########################
        // # Central node handling #
        // #########################
        var event = "node:" + config.id;
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
            startAction(ACTION_STOP);
            RED.events.off(event, handler);
        });


        // #####################
        // # Private functions #
        // #####################

        // This is the main function which handles all topics that was received.
        let handleTopic = msg =>
        {
            helper.log(node, "handle topic:", msg);

            let real_topic = helper.getRealTopic(msg.topic, "toggle", ["up", "up_stop", "down", "down_stop", "stop", "toggle", "up_down", "position", "alarm"]);

            // skip if button is released
            if (msg.payload === false && ["up", "up_stop", "down", "down_stop", "stop", "toggle"].includes(real_topic))
                return;

            // Convert up_down from HA UI to next command
            if (real_topic == "up_down")
            {
                if (msg.payload)
                    real_topic = "down";
                else
                    real_topic = "up";

                delete msg.payload;
            }

            // Correct next topic to avoid handling up_stop, down_stop or toggle separately.
            if (timeout != null && ["up_stop", "down_stop", "toggle"].includes(real_topic))
            {
                real_topic = "stop";
            }
            else if (timeout == null)
            {
                // shutter is not running, set next command depending on topic
                switch (real_topic)
                {
                    case "up_stop":
                        real_topic = "up";
                        break;

                    case "down_stop":
                        real_topic = "down";
                        break;

                    case "toggle":
                        real_topic = node_settings.last_direction_up ? "down" : "up";
                        break;
                }
            }

            helper.log(node, "handle real topic: " + real_topic);
            switch (real_topic)
            {
                case "debug":
                    helper.nodeDebug(node, {
                        node_settings,
                        max_time_up,
                        max_time_down,
                        revert_time_ms,
                        alarm_action,
                        alarm_off_action,
                    });
                    break;

                case "up":
                    startAction(ACTION_UP, msg.time_on ?? null, msg.exact ?? null);
                    break;

                case "stop":
                    startAction(ACTION_STOP);
                    break;

                case "down":
                    startAction(ACTION_DOWN, msg.time_on ?? null, msg.exact ?? null);
                    break;

                case "position":
                    startAction(ACTION_POSITION, msg.payload ?? null);
                    break;

                case "alarm":
                    // Make sure it is bool
                    msg.payload = !!msg.payload;

                    // No alarm change, do nothing
                    if (node_settings.alarm_active == msg.payload)
                        return;

                    node_settings.alarm_active = msg.payload;

                    if (node_settings.alarm_active)
                        handleAlarmOn();
                    else
                        handleAlarmOff();

                    break;
            }
        };

        /**
         * This function is called when the alarm changes from off to on
         */
        let handleAlarmOn = () =>
        {
            switch (alarm_action)
            {
                case "UP":
                    startAction(ACTION_UP, null, null, true);
                    break;

                case "DOWN":
                    startAction(ACTION_DOWN, null, null, true);
                    break;
            }
        }

        /**
         * This function is called when the alarm changes from on to off
         */
        let handleAlarmOff = () =>
        {
            switch (alarm_off_action)
            {
                case "NOTHING":
                    break;

                case "UP":
                    startAction(ACTION_UP);
                    break;

                case "DOWN":
                    startAction(ACTION_DOWN);
                    break;

                case "LAST":
                    startAction(ACTION_POSITION, node_settings.last_position_before_alarm);
                    break;
            }
        }

        /**
         * This functions stops the shutter if needed and starts the requested action.
         * 
         * @param {int} action One of ACTION_UP, ACTION_STOP, ACTION_DOWN or ACTION_POSITION.
         * @param {string|float|null} data For ACTION_POSITION this is the position, for ACTION_UP and ACTION_DOWN it is the max run time.
         * @param {boolean?} exact If true, the exact given time is used, otherwise some offset at 0% and 100% is used to ensure the shutter reach the end.
         * @param {boolean?} ignoreAlarm If true, the action is performed even the alarm is activated. The default is false.
         */
        let startAction = (action, data = null, exact = false, ignoreAlarm = false) =>
        {
            helper.log(node, "startAction", { action, data, exact, ignoreAlarm });

            // Nothing allowed if alarm is on
            if (ignoreAlarm === false && node_settings.alarm_active)
                return;

            // Variable declarations
            let run_time_ms;
            let needStop = false;
            let now = Date.now();
            let currentPosition = calcNewPosition();

            // handle 0% and 100% as UP and DOWN command
            if (action == ACTION_POSITION && data === 0)
            {
                action = ACTION_UP;
                data = null;
            }
            else if (action == ACTION_POSITION && data === 100)
            {
                action = ACTION_DOWN;
                data = null;
            }

            // Stop waiting for revert time, it will be restarted later with the correct following action
            if (wait_timeout != null)
            {
                clearTimeout(wait_timeout);
                wait_timeout = null;
            }

            // Shutter is running, check if it has to be stopped first
            if (timeout != null)
            {
                switch (action)
                {
                    case ACTION_UP:
                        if (node_settings.last_direction_up === false)
                            needStop = true;
                        break;

                    case ACTION_DOWN:
                        if (node_settings.last_direction_up === true)
                            needStop = true;
                        break;

                    case ACTION_STOP:
                        needStop = true;
                        break;

                    case ACTION_POSITION:
                        // Wrong direction, do stop
                        if (node_settings.last_direction_up === true && currentPosition < data)
                            needStop = true;
                        if (node_settings.last_direction_up === false && currentPosition > data)
                            needStop = true;
                        break;
                }
            }

            // Stop shutter if needed and save new positions
            if (needStop)
            {
                clearTimeout(timeout);
                off_time = Date.now();
                timeout = null;

                if (!node_settings.alarm_active)
                    node_settings.last_position_before_alarm = currentPosition;

                node_settings.last_position = currentPosition;
                sendToOutput(false, false);
            }

            // Determine needed runtime
            switch (action)
            {
                case ACTION_STOP:
                    // Already stopped, nothing more to do
                    return;

                case ACTION_UP:
                    // data is the run time
                    if (data == null)
                        run_time_ms = node_settings.last_position * max_time_up / 100 * 1000;
                    else
                        run_time_ms = helper.getTimeInMsFromString(data);
                    break;

                case ACTION_DOWN:
                    // data is the run time
                    if (data == null)
                        run_time_ms = (100 - node_settings.last_position) * max_time_down / 100 * 1000;
                    else
                        run_time_ms = helper.getTimeInMsFromString(data);
                    break;

                case ACTION_POSITION:
                    // data is the position in percent
                    if (data == null)
                    {
                        helper.warn(this, "Try to set position without giving a new position");
                        return;
                    }

                    // Make sure it is in range 0-100
                    data = Math.min(100, Math.max(0, data));

                    // Convert to UP/DOWN with a specific time
                    if (data < currentPosition)
                    {
                        run_time_ms = (currentPosition - data) / 100 * max_time_up * 1000;
                        action = ACTION_UP;
                    }
                    else // if (data > currentPosition)
                    {
                        action = ACTION_DOWN;
                        run_time_ms = (data - currentPosition) / 100 * max_time_down * 1000;
                    }
                    break;
            }

            if (exact !== true && data == null)
            {
                // Run at least for 5 seconds
                if (run_time_ms < 5000)
                    run_time_ms = 5000;
            }

            let dirChange = ((action == ACTION_UP && !node_settings.last_direction_up) || (action == ACTION_DOWN && node_settings.last_direction_up));

            // Just to make sure there is no mistake
            if (run_time_ms < 0)
                run_time_ms = 0;

            if (timeout != null)
            {
                // This happens if the time needs to be changed, but the direction is the same
                clearTimeout(timeout);
                helper.log(node, "stop after " + run_time_ms + "ms");

                off_time = Date.now();
                on_time = off_time;
                node_settings.last_position = currentPosition;

                timeout = setTimeout(() =>
                {
                    // Just stop after the new time
                    startAction(ACTION_STOP, null, null, ignoreAlarm);
                    timeout = null;

                    smart_context.set(node.id, node_settings);

                    setStatus();
                }, run_time_ms);
            }
            else if (off_time + revert_time_ms - now > 0 && dirChange)
            {
                // revert time is not fully passed
                helper.log(node, "revert time is not fully passed, wait for " + (off_time + revert_time_ms - now) + "ms");
                wait_timeout = setTimeout(() =>
                {
                    wait_timeout = null;
                    startAction(action, data, exact, ignoreAlarm);

                    smart_context.set(node.id, node_settings);

                    setStatus();
                }, off_time + revert_time_ms - now);
            }
            else if (run_time_ms == 0)
            {
                // Do nothing.
                // This can happen if exact = true but the shutter is already at the target position
            }
            else
            {
                // The shutter can finally be started.
                switch (action)
                {
                    case ACTION_UP:
                        helper.log(node, "start ACTION_UP");
                        sendToOutput(true, false);
                        break;

                    case ACTION_DOWN:
                        helper.log(node, "start ACTION_DOWN");
                        sendToOutput(false, true);
                        break;
                }

                if (!node_settings.alarm_active)
                    node_settings.last_position_before_alarm = currentPosition;

                on_time = Date.now();

                helper.log(node, "stop after " + run_time_ms + "ms");
                timeout = setTimeout(() =>
                {
                    startAction(ACTION_STOP, null, null, ignoreAlarm);
                    timeout = null;

                    smart_context.set(node.id, node_settings);

                    setStatus();
                }, run_time_ms);
            }
        }

        /**
         * 
         * @param {*} up 
         * @param {*} down 
         * @returns 
         */
        let sendToOutput = (up, down) =>
        {
            helper.log(node, "sendToOutput", { up, down });

            if (up && down)
            {
                console.error("Fatal exception, Cannot send up and down at the same time.");
                return;
            }

            if (up)
                node_settings.last_direction_up = true;
            else if (down)
                node_settings.last_direction_up = false;

            node.send([{ payload: up }, { payload: down }, { payload: node_settings.last_position }]);

            // Inform central nodes that shutter is running/stopped
            notifyCentral(up || down);
        }

        /**
         * 
         * @returns 
         */
        let calcNewPosition = () =>
        {
            let now = Date.now();

            if (timeout == null)
                return node_settings.last_position;

            // Change position while running,
            // Calculate current position first
            if (node_settings.last_direction_up)
            {
                let change_percentage = (now - on_time) / 1000 / max_time_up * 100;
                return Math.max(0, node_settings.last_position - change_percentage);
            }
            else
            {
                let change_percentage = (now - on_time) / 1000 / max_time_down * 100;
                return Math.min(100, node_settings.last_position + change_percentage);
            }
        }

        /**
         * Set the current node status
         */
        let setStatus = () =>
        {
            let fill = node_settings.alarm_active ? "red" : "green";
            let shape = timeout != null ? "ring" : "dot";

            // collect all texts and join later with a comma
            let texts = [];

            if (node_settings.alarm_active)
                texts.push("ALARM");

            if (timeout == null)
                texts.push("Stopped");
            else if (node_settings.last_direction_up)
                texts.push("Up");
            else
                texts.push("Down");

            texts.push("Position: " + node_settings.last_position?.toFixed(0) + "%");

            node.status({ fill, shape, text: helper.getCurrentTimeForStatus() + ": " + texts.join(", ") });
        }

        /**
         * Notify all connected central nodes
         * @param {boolean} state The state if the shutter is running
         * @returns 
         */
        let notifyCentral = state =>
        {
            if (!config.links)
                return;

            config.links.forEach(link =>
            {
                helper.log(node, link, { source: node.id, state: state });
                RED.events.emit("node:" + link, { source: node.id, state: state });
            });
        };

        // For security reason, stop shutter at node start
        wait_timeout = setTimeout(() =>
        {
            wait_timeout = null;

            sendToOutput(false, false);
            notifyCentral(false);

            if (node_settings.alarm_active)
                handleAlarmOn();

            setStatus();
        }, 10000);
    }

    RED.nodes.registerType("smart_shutter-complex-control", ShutterComplexControlNode);
};
