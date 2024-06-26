module.exports = function (RED)
{
    "use strict";

    function ShutterControlNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        // used from text-exec node
        if (typeof config.exec_text_names == "string")
            node.exec_text_names = config.exec_text_names.split(",").map(n => n.trim().toLowerCase());
        else
            node.exec_text_names = [];

        // persistent values
        var node_settings = Object.assign({}, {
            last_position: 0,        // 0 = opened, 100 = closed
            last_direction_up: true, // remember last direction for toggle action
        }, smart_context.get(node.id));

        // dynamic config
        let short_time_on_ms = config.short_time_on_ms || 200;

        // runtime values
        let is_running = false;         // remember if shutter is running, this is only recognized when starting within this control or position 0% or 100% is reached.
        let max_time_on_timeout = null; // save timeout value to cancel auto timeout if needed

        // central handling
        var event = "node:" + config.id;
        var handler = function (msg)
        {
            node.receive(msg);
        }
        RED.events.on(event, handler);

        node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Stopped at " + Math.round(node_settings.last_position) + "%" });

        node.on("input", function (msg)
        {
            handleTopic(msg);

            smart_context.set(node.id, node_settings);
        });

        node.on("close", function ()
        {
            stopAutoOff();
            RED.events.off(event, handler);
        });

        let handleTopic = msg =>
        {
            var resultUpDown = null;
            var resultStop = null;
            var resultPosition = null;

            var real_topic = helper.getTopicName(msg.topic);

            // set default topic
            if (!["status", "status_position", "up_down", "up", "up_stop", "down", "down_stop", "stop", "toggle", "position", "short_up_down"].includes(real_topic))
                real_topic = "toggle";

            // skip if button is released
            if (msg.payload === false && ["up", "up_stop", "down", "down_stop", "stop", "toggle"].includes(real_topic))
                return;

            // Correct next topic to avoid handling up_stop, down_stop or toggle separately.
            if ((max_time_on_timeout != null || is_running) && (real_topic == "up_stop" || real_topic == "down_stop" || real_topic == "toggle"))
            {
                real_topic = "stop";
            }
            else if (max_time_on_timeout == null && !is_running)
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


            switch (real_topic)
            {
                case "status":
                case "status_position":
                    node_settings.last_direction_up = node_settings.last_position > msg.payload;
                    node_settings.last_position = msg.payload;

                    if (is_running && (msg.payload == 0 || msg.payload == 100))
                        is_running = false;

                    node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": Position status received: " + msg.payload + "%" });
                    return;

                // This is only used to track starting of the shutter
                case "up_down":
                    node_settings.last_direction_up = !msg.payload;
                    is_running = true;

                    if (node_settings.last_direction_up)
                        node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Up" });
                    else
                        node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Down" });
                    return;

                case "short_up_down":
                    handleTopic({ topic: msg.payload ? "down" : "up", time_on: msg.time_on ?? short_time_on_ms });
                    return;

                case "up":
                    node_settings.last_direction_up = true;
                    is_running = true;
                    resultUpDown = false;
                    node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Up" });
                    startAutoOffIfNeeded(msg);
                    break;

                case "stop":
                    is_running = false;
                    resultStop = true;
                    stopAutoOff();
                    node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Stopped" });
                    break;

                case "down":
                    node_settings.last_direction_up = false;
                    is_running = true;
                    resultUpDown = true;
                    node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Down" });
                    startAutoOffIfNeeded(msg);
                    break;

                case "position":
                    let value = parseFloat(msg.payload);

                    if (value < 0) value = 0;
                    if (value > 100) value = 100;
                    // is_running = true; // Not guaranteed that the shutter starts running.
                    resultPosition = value;
                    node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Set position to " + value + "%" });
                    break;
            }

            if (resultUpDown != null)
            {
                node.send([{ payload: resultUpDown, topic: "up_down" }, null, null]);
                notifyCentral(true);
            }
            else if (resultStop != null)
            {
                node.send([null, { payload: resultStop, topic: "stop" }, null]);
                notifyCentral(false);
            }
            else if (resultPosition != null)
            {
                node.send([null, null, { payload: resultPosition, topic: "position" }]);
            }
        };

        let startAutoOffIfNeeded = msg =>
        {
            if (!msg.time_on)
                return;

            let timeMs = helper.getTimeInMsFromString(msg.time_on);
            if (isNaN(timeMs))
            {
                node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Invalid time_on value send: '" + msg.time_on + "'" });
                return;
            }

            if (timeMs <= 0)
            {
                node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": time_on value has to be greater than 0" });
                return;
            }

            // Stop if any timeout is set
            stopAutoOff();

            node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": Wait " + (timeMs / 1000).toFixed(1) + " sec for auto off" });
            max_time_on_timeout = setTimeout(() =>
            {
                node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Stopped" });
                is_running = false;
                node.send([null, { payload: true }, null]);
                notifyCentral(false);
            }, timeMs);
        };

        let stopAutoOff = () =>
        {
            if (max_time_on_timeout != null)
            {
                node.status({});
                clearTimeout(max_time_on_timeout);
                max_time_on_timeout = null;
            }
        };

        let notifyCentral = state =>
        {
            if (!config.links)
                return;

            config.links.forEach(link =>
            {
                // console.log(node.id + " -> " + link);
                // console.log({ source: node.id, state: state });
                RED.events.emit("node:" + link, { source: node.id, state: state });
            });
        };
    }
    RED.nodes.registerType("smart_shutter-control", ShutterControlNode);
};
