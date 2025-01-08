module.exports = function (RED)
{
    "use strict";

    function ShutterControlNode(config)
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
            last_position: 0,        // 0 = opened, 100 = closed
            last_direction_up: true, // remember last direction for toggle action
        }, smart_context.get(node.id));


        // ##################
        // # Dynamic config #
        // ##################
        let short_time_on_ms = parseInt(config.short_time_on_ms || 200, 10);
        let data_type = config.data_type || "SIMPLE";


        // ##################
        // # Runtime values #
        // ##################

        // Here the setTimeout return value is stored to stop the shutter.
        // That means if it is null, the shutter is stopped.
        let timeout = null;

        // This is set to true if a command to start the shutter is recognized.
        let is_running = false;


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
            helper.log("handle topic:");
            helper.log(msg);

            var resultUpDown = null;
            var resultStop = null;
            var resultPosition = null;

            let real_topic = helper.getRealTopic(msg.topic, "toggle", ["status", "status_position", "up_down", "up", "up_stop", "down", "down_stop", "stop", "toggle", "position", "short_up_down"]);

            // skip if button is released
            if (msg.payload === false && ["up", "up_stop", "down", "down_stop", "stop", "toggle"].includes(real_topic))
                return;

            // Correct next topic to avoid handling up_stop, down_stop or toggle separately.
            if (real_topic == "short_up_down")
            {
                real_topic = msg.payload ? "down" : "up";
                if (msg.time_on == null)
                    msg.time_on = short_time_on_ms;
            }

            if ((timeout != null || is_running) && (real_topic == "up_stop" || real_topic == "down_stop" || real_topic == "toggle"))
            {
                real_topic = "stop";
            }
            else if (timeout == null && !is_running)
            {
                // shutter is not running, set next command depending on topic
                if (real_topic == "up_stop")
                    real_topic = "up";
                else if (real_topic == "down_stop")
                    real_topic = "down";
                else if (node_settings.last_direction_up && real_topic == "toggle")
                    real_topic = "down";
                else if (!node_settings.last_direction_up && real_topic == "toggle")
                    real_topic = "up";
            }

            helper.log("handle real topic: " + real_topic);
            switch (real_topic)
            {
                case "status":
                case "status_position":
                    node_settings.last_direction_up = node_settings.last_position > msg.payload;
                    node_settings.last_position = msg.payload;

                    if (is_running && (msg.payload == 0 || msg.payload == 100))
                        is_running = false;
                    return;

                case "up_down":
                    // This is only used to track starting of the shutter
                    node_settings.last_direction_up = !msg.payload;
                    is_running = true;
                    return;

                case "up":
                    node_settings.last_direction_up = true;
                    is_running = true;
                    resultUpDown = false;
                    startAutoOffIfNeeded(msg);
                    break;

                case "stop":
                    is_running = false;
                    resultStop = true;
                    stopAutoOff();
                    break;

                case "down":
                    node_settings.last_direction_up = false;
                    is_running = true;
                    resultUpDown = true;
                    startAutoOffIfNeeded(msg);
                    break;

                case "position":
                    let value = parseFloat(msg.payload);

                    if (value < 0) value = 0;
                    if (value > 100) value = 100;
                    // is_running = true; // Not guaranteed that the shutter starts running.
                    resultPosition = value;
                    break;
            }

            if (resultUpDown != null)
            {
                sendDirection(resultUpDown);
                notifyCentral(true);
            }
            else if (resultStop != null)
            {
                sendStop();
                notifyCentral(false);
            }
            else if (resultPosition != null)
            {
                sendPosition(cover.set_cover_position);
            }
        };

        /**
         * This function sets a timeout to stop the shutter after the defined time is over.
         * @param {*} msg The original message object
         */
        let startAutoOffIfNeeded = msg =>
        {
            if (msg.time_on == null || msg.time_on == 0)
                return;

            // calculate needed time
            let timeMs = helper.getTimeInMsFromString(msg.time_on);
            if (isNaN(timeMs) || timeMs <= 0)
            {
                helper.warn(this, "Invalid msg.time_on value was sent.", msg);
                return;
            }

            // Stop if any timeout is set
            stopAutoOff();

            timeout = setTimeout(() =>
            {
                is_running = false;
                timeout = null;

                sendStop();
                notifyCentral(false);

                smart_context.set(node.id, node_settings);

                setStatus();
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
            let fill = "green";
            let shape = (timeout != null || is_running) ? "ring" : "dot";

            // collect all texts and join later with a comma
            let texts = [];

            if (timeout == null && !is_running)
                texts.push("Stopped");
            else if (node_settings.last_direction_up)
                texts.push("Up");
            else
                texts.push("Down");

            texts.push("Position: " + node_settings.last_position?.toFixed(0) + "%");

            node.status({ fill, shape, text: helper.getCurrentTimeForStatus() + ": " + texts.join(", ") });
        }

        /**
         * Turns the shutter to the given direction and returns the sent message
         * @param {bool} down True if down, else up
         * @returns The sent message
         */
        let sendDirection = down =>
        {
            if (down)
                return sendTurnDown();

            return sendTurnUp();
        }

        /**
         * Turns the shutter up and returns the sent message
         * @returns The sent message
         */
        let sendTurnUp = () =>
        {
            let data = null;
            switch (data_type)
            {
                case "SIMPLE":
                    data = [{ payload: false }, null, null];
                    break;

                case "HOMEASSISTANT":
                    data = { payload: { action: "cover.open_cover" } };
                    break;

                default:
                    return null;
            }
            node.send(data);
            return data;
        }

        /**
         * Turns the shutter down and returns the sent message
         * @returns The sent message
         */
        let sendTurnDown = () =>
        {
            let data = null;
            switch (data_type)
            {
                case "SIMPLE":
                    data = [{ payload: true }, null, null];
                    break;

                case "HOMEASSISTANT":
                    data = { payload: { action: "cover.close_cover" } };
                    break;

                default:
                    return null;
            }
            node.send(data);
            return data;
        }

        /**
         * Stops the shutter and returns the sent message
         * @returns The sent message
         */
        let sendStop = () =>
        {
            let data = null;
            switch (data_type)
            {
                case "SIMPLE":
                    data = [null, { payload: true }, null];
                    break;

                case "HOMEASSISTANT":
                    data = { payload: { action: "cover.stop_cover" } };
                    break;

                default:
                    return null;
            }
            node.send(data);
            return data;
        }

        /**
         * Turns the shutter to the given position and returns the sent message
         * @returns The sent message
         */
        let sendPosition = position =>
        {
            let data = null;
            switch (data_type)
            {
                case "SIMPLE":
                    data = [null, null, { payload: position }];
                    break;

                case "HOMEASSISTANT":
                    // In Simple, 0% is open
                    // In HomeAssistant 100% is open
                    data = { payload: { action: "cover.set_cover_position", data: { position: 100 - position } } };
                    break;

                default:
                    return null;
            }
            node.send(data);
            return data;
        }


        /**
         * Notify all connected central nodes
         * @param {boolean} state The state if the shutter is running
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
        };
    }
    RED.nodes.registerType("smart_shutter-control", ShutterControlNode);
};
