module.exports = function (RED)
{
    "use strict";

    function CounterNode(config)
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

        // #####################
        // # persistent values #
        // #####################
        var node_settings = {
            value: null,
            last_message: null,
            config_change_date: config.config_change_date,
        };

        // load or delete saved values
        if (config.save_state)
            node_settings = Object.assign(node_settings, smart_context.get(node.id, config.config_change_date));
        else
            smart_context.del(node.id);


        // ##################
        // # Dynamic config #
        // ##################
        let start = parseInt(config.start, 10);
        let step = parseInt(config.step, 10);
        let min = parseInt(config.min, 10);
        let max = parseInt(config.max, 10);
        let out_message = helper.evaluateNodeProperty(RED, config.out_message, config.out_message_type);


        // ##################
        // # Runtime values #
        // ##################
        // Not used by this node

        node.on("input", function (msg)
        {
            handleTopic(msg);

            sendResult();

            setStatus();
            smart_context.set(node.id, node_settings);
        });

        node.on("close", function ()
        {
        });


        // #####################
        // # Private functions #
        // #####################

        // This is the main function which handles all topics that was received.
        let handleTopic = msg =>
        {
            let real_topic = helper.getTopicName(msg.topic);
            let temp_value;
            switch (real_topic)
            {
                case "debug":
                    helper.nodeDebug(node, {
                        node_settings,
                        start,
                        step,
                        min,
                        max,
                        out_message,
                    });
                    break;

                case "set_min":
                    min = parseFloat(msg.payload);
                    break;

                case "set_max":
                    max = parseFloat(msg.payload);
                    break;

                case "set_step":
                    step = parseFloat(msg.payload);
                    break;

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

        /**
         * Send the result to the output
         */
        let sendResult = () =>
        {
            // Nothing changed, nothing to do
            if (node_settings.value == node_settings.last_message?.payload)
                return;

            // if out_message is set, use this instead of the default message
            if (out_message)
                node_settings.last_message = helper.cloneObject(out_message, { payload: node_settings.value });
            else
                node_settings.last_message = { payload: node_settings.value };

            node.send(node_settings.last_message);
        }

        // updates the status
        let setStatus = () =>
        {
            if (node_settings.value == null)
                node.status({});
            else
                node.status({ fill: "yellow", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Min = " + min + " |  Max = " + max + " | Value = " + node_settings.value });
        }

        if (config.save_state && config.resend_on_start && node_settings.last_message != null)
        {
            setTimeout(() =>
            {
                node.send(helper.cloneObject(node_settings.last_message));
            }, 10000);
        }

        setStatus();
    }

    RED.nodes.registerType("smart_counter", CounterNode);
}
