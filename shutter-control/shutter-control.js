module.exports = function (RED)
{
    function ShutterControlNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smartContext = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        // persistent values
        var nodeSettings = Object.assign({}, {
            last_position: 0,        // 0 = opened, 100 = closed
            last_direction_up: true, // remember last direction for toggle action
        }, smartContext.get(node.id));

        // dynamic config

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

        node.status({ fill: "red", shape: "dot", text: "Stopped at " + Math.round(nodeSettings.last_position) + "%" });

        node.on("input", function (msg)
        {
            handleTopic(msg);

            smartContext.set(node.id, nodeSettings);
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

            var realTopic = helper.getTopicName(msg.topic);

            // set default topic
            if (!["status", "status_position", "up_down", "up", "up_stop", "down", "down_stop", "stop", "toggle", "position"].includes(realTopic))
                realTopic = "toggle";

            // skip if button is released
            if (msg.payload === false && ["up", "up_stop", "down", "down_stop", "stop", "toggle"].includes(realTopic))
                return;

            // Correct next topic to avoid handling up_stop, down_stop or toggle separately.
            if ((max_time_on_timeout != null || is_running) && (realTopic == "up_stop" || realTopic == "down_stop" || realTopic == "toggle"))
            {
                realTopic = "stop";
            }
            else if (max_time_on_timeout == null && !is_running)
            {
                // shutter is not running, set next command depending on topic
                if (realTopic == "up_stop")
                    realTopic = "up";
                else if (realTopic == "down_stop")
                    realTopic = "down";
                else if (nodeSettings.last_direction_up && realTopic == "toggle")
                    realTopic = "down";
                else if (!nodeSettings.last_direction_up && realTopic == "toggle")
                    realTopic = "up";
            }


            switch (realTopic)
            {
                case "status":
                case "status_position":
                    nodeSettings.last_direction_up = nodeSettings.last_position > msg.payload;
                    nodeSettings.last_position = msg.payload;

                    if (is_running && (msg.payload == 0 || msg.payload == 100))
                        is_running = false;

                    node.status({ fill: "yellow", shape: "ring", text: "Position status received: " + msg.payload + "%" });
                    return;

                // This is only used to track starting of the shutter
                case "up_down":
                    nodeSettings.last_direction_up = !msg.payload;
                    is_running = true;

                    if (nodeSettings.last_direction_up)
                        node.status({ fill: "green", shape: "dot", text: "Up" });
                    else
                        node.status({ fill: "green", shape: "dot", text: "Down" });
                    return;

                case "up":
                    nodeSettings.last_direction_up = true;
                    is_running = true;
                    resultUpDown = false;
                    node.status({ fill: "green", shape: "dot", text: "Up" });
                    startAutoOffIfNeeded(msg);
                    break;

                case "stop":
                    is_running = false;
                    resultStop = true;
                    stopAutoOff();
                    node.status({ fill: "green", shape: "dot", text: "Stopped" });
                    break;

                case "down":
                    nodeSettings.last_direction_up = false;
                    is_running = true;
                    resultUpDown = true;
                    node.status({ fill: "green", shape: "dot", text: "Down" });
                    startAutoOffIfNeeded(msg);
                    break;

                case "position":
                    let value = parseFloat(msg.payload);

                    if (value < 0) value = 0;
                    if (value > 100) value = 100;
                    // is_running = true; // Not guaranteed that the shutter starts running.
                    resultPosition = value;
                    node.status({ fill: "green", shape: "dot", text: "Set position to " + value + "%" });
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
                node.status({ fill: "red", shape: "dot", text: "Invalid time_on value send: " + msg.time_on });
                return;
            }

            if (timeMs <= 0)
            {
                node.status({ fill: "red", shape: "dot", text: "time_on value has to be greater than 0" });
                return;
            }

            // Stop if any timeout is set
            stopAutoOff();

            node.status({ fill: "yellow", shape: "ring", text: "Wait " + (timeMs / 1000).toFixed(1) + " sec for auto off" });
            max_time_on_timeout = setTimeout(() =>
            {
                node.status({ fill: "green", shape: "dot", text: "Stopped" });
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
                RED.events.emit("node:" + link, { source: node.id, state: state });
            });
        };
    }
    RED.nodes.registerType("smart_shutter-control", ShutterControlNode);
};
