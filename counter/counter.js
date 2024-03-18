module.exports = function (RED)
{
    "use strict";

    function CounterNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        var node_settings = {
            value: null,
            last_message: null,
        };

        if (config.save_state)
        {
            // load old saved values
            node_settings = Object.assign(node_settings, smart_context.get(node.id));
        }
        else
        {
            // delete old saved values
            smart_context.del(node.id);
        }

        // dynamic config
        let start = config.start;
        let step = config.step;
        let min = config.min;
        let max = config.max;

        // runtime values

        node.on("input", function (msg)
        {
            handleTopic(msg);
            sendResult();
            setStatus();
        });

        let handleTopic = msg =>
        {
            let real_topic = helper.getTopicName(msg.topic);
            let temp_value;
            switch (real_topic)
            {
                case "up":
                    temp_value = parseFloat(msg.payload);
                    if (isNaN(temp_value) && !isFinite(temp_value))
                        temp_value = step;

                    node_settings.value += temp_value;
                    break;

                case "down":
                    temp_value = parseFloat(msg.payload);
                    if (isNaN(temp_value) && !isFinite(temp_value))
                        temp_value = step;

                    node_settings.value -= temp_value;
                    break;

                case "reset":
                    temp_value = parseFloat(msg.payload);
                    if (isNaN(temp_value) && !isFinite(temp_value))
                        temp_value = start;

                    node_settings.value = temp_value;
                    break;

                default:
                    node.error("Invalid topic: " + real_topic);
                    return;
            }

            // Check value is in range
            node_settings.value = Math.min(max, Math.max(min, node_settings.value));
        }

        let sendResult = () =>
        {
            // Nothing changed, nothing to do
            if (node_settings.value == node_settings.last_message?.payload)
                return;

            node_settings.last_message = { payload: node_settings.value };
            smart_context.set(node.id, node_settings);

            node.send(node_settings.last_message);
        }

        node.on("close", function ()
        {
        });

        // updates the status
        let setStatus = () =>
        {
            if (node_settings.value == null)
                node.status({});
            else
                node.status({ fill: "yellow", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Value = " + node_settings.value });
        }

        if (config.save_state && config.resend_on_start && node_settings.last_message != null)
        {
            setTimeout(() =>
            {
                node.send(node_settings.last_message);
            }, 10000);
        }

        setStatus();
    }

    RED.nodes.registerType("smart_counter", CounterNode);
}
