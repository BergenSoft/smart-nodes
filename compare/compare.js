module.exports = function (RED)
{
    "use strict";

    function CompareNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        // persistant values
        var node_settings = {
            values: [
                helper.evaluateNodeProperty(RED, config.value1, config.value1_type),
                helper.evaluateNodeProperty(RED, config.value2, config.value2_type)
            ],
            last_result: null,
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
        let comparator = config.comparator;
        let out_true = helper.evaluateNodeProperty(RED, config.out_true, config.out_true_type);
        let out_false = helper.evaluateNodeProperty(RED, config.out_false, config.out_false_type);
        let send_only_change = helper.evaluateNodeProperty(RED, config.send_only_change, "bool");
        let outputs = helper.evaluateNodeProperty(RED, config.outputs, "num");

        // runtime values

        node.on("input", function (msg)
        {
            // Check if topic has a valid value
            let input = helper.getTopicNumber(msg.topic);
            if (input == null || input < 1 || input > 2)    
            {
                node.error(RED._("compare.errors.wrong_topic") + msg.topic);
                return;
            }

            // check if payload has a valid value
            let num = parseFloat(msg.payload);
            if (Number.isNaN(num))
            {
                // node.error("Payload has to be numeric");
                return;
            }

            // Save new value
            node_settings.values[input - 1] = num;

            let result = getResult();
            let out_msg = null;

            setStatus(result);

            if (result != null)
            {
                // Get custom output message
                if (result)
                {
                    if (out_true !== null)
                        out_msg = Object.assign({}, out_true);
                }
                else
                {
                    if (out_false !== null)
                        out_msg = Object.assign({}, out_false);
                }

                if (out_msg !== null)
                {
                    // Overwrite automatic values, if not already defined
                    if (typeof out_msg.payload === "undefined")
                        out_msg.payload = result;

                    if (typeof out_msg.comparator === "undefined")
                        out_msg.comparator = comparator;

                    // Separate outputs if needed
                    if (outputs == 2)
                    {
                        if (result)
                            out_msg = [out_msg, null];
                        else
                            out_msg = [null, out_msg];
                    }

                    // Send only if needed
                    if (send_only_change == false || node_settings.last_result != result)
                        node.send(out_msg);
                }

                node_settings.last_result = result;
                node_settings.last_message = out_msg;

                if (config.save_state)
                    smart_context.set(node.id, node_settings);
            }
        });

        let getResult = () =>
        {
            // Wait until both values are set
            if (node_settings.values[0] == null || node_settings.values[1] == null)
                return null;

            switch (comparator)
            {
                case "SMALLER":
                    return node_settings.values[0] < node_settings.values[1];

                case "SMALLER_EQUAL":
                    return node_settings.values[0] <= node_settings.values[1];

                case "EQUAL":
                    return node_settings.values[0] === node_settings.values[1];

                case "UNEQUAL":
                    return node_settings.values[0] !== node_settings.values[1];

                case "GREATER_EQUAL":
                    return node_settings.values[0] >= node_settings.values[1];

                case "GREATER":
                    return node_settings.values[0] > node_settings.values[1];
            }

            return null;
        }

        // This is only used for status message
        let getComparatorSign = () =>
        {
            switch (comparator)
            {
                case "SMALLER":
                    return "<";

                case "SMALLER_EQUAL":
                    return "<=";

                case "EQUAL":
                    return "==";

                case "UNEQUAL":
                    return "!=";

                case "GREATER_EQUAL":
                    return ">=";

                case "GREATER":
                    return ">";
            }
            return "???";
        }

        // updates the status
        let setStatus = (result) =>
        {
            if (result == null)
                node.status({});
            else
                node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": " + node_settings.values.join(" " + getComparatorSign() + " ") + " => " + result });
        }

        node.on("close", function ()
        {
        });

        if (config.save_state && config.resend_on_start && node_settings.last_message != null)
        {
            setTimeout(() =>
            {
                node.send(node_settings.last_message);
            }, 10000);
        }

        setStatus(node_settings.last_message?.payload);
    }

    RED.nodes.registerType("smart_compare", CompareNode);
}
