module.exports = function (RED)
{
    "use strict";

    function LogicNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        // persistant values
        var node_settings = {
            input_states: Array.from({ length: config.logic_inputs }).fill(false),
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
        let logic = config.logic;
        let out_true = helper.evaluateNodeProperty(RED, config.out_true, config.out_true_type || "json");
        let out_false = helper.evaluateNodeProperty(RED, config.out_false, config.out_false_type || "json");
        let logic_inputs = config.logic_inputs;
        let inverts = config.inverts.split(",").map(n => parseInt(n));
        let invert_output = config.invert_output;
        let send_only_change = helper.evaluateNodeProperty(RED, config.send_only_change, "bool");
        let outputs = helper.evaluateNodeProperty(RED, config.outputs, "num");

        // runtime values

        node.on("input", function (msg)
        {
            if (typeof msg.topic === "undefined")
            {
                node.error("Topic not set");
                return;
            }
            let input = helper.getTopicNumber(msg.topic);

            if (input == null || input < 1 || input > logic_inputs)    
            {
                node.error("Topic has to be >= 1 and <= " + logic_inputs + ", send: " + msg.topic);
                return;
            }

            if (inverts.includes(input))
                node_settings.input_states[input - 1] = !msg.payload;
            else
                node_settings.input_states[input - 1] = !!msg.payload; // !! => Convert to boolean

            let result = getResult();
            let out_msg = null;

            setStatus();

            if (invert_output)
                result = !result;

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
        });

        node.on("close", function ()
        {
        });

        let getResult = () =>
        {
            let result = false;

            switch (logic)
            {
                case "AND":
                    result = true;
                    for (let i = 0; i < logic_inputs; i++)
                    {
                        const element = node_settings.input_states[i];
                        if (element == false)
                        {
                            result = false;
                            break;
                        }
                    }
                    break;

                case "OR":
                    result = false;
                    for (let i = 0; i < logic_inputs; i++)
                    {
                        const element = node_settings.input_states[i];
                        if (element == true)
                        {
                            result = true;
                            break;
                        }
                    }
                    break;

                case "XOR":
                    let oneTrue = false;
                    result = false;

                    for (let i = 0; i < logic_inputs; i++)
                    {
                        const element = node_settings.input_states[i];
                        if (element && oneTrue)
                        {
                            result = false;
                            break;
                        }
                        else if (element)
                        {
                            oneTrue = true;
                            result = true;
                        }
                    }
                    break;
            }
            return result;
        }

        let setStatus = () =>
        {
            let state = [];
            for (let i = 0; i < logic_inputs; i++)
            {
                let invert = inverts.includes(i + 1);
                const element = node_settings.input_states[i];

                state.push((invert ? "!" + (!element) : "" + element));
            }

            let result = getResult();
            let resultText = (invert_output ? "!" : "") + result;

            node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": [" + state.join(", ") + "] => " + resultText });
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

    RED.nodes.registerType("smart_logic", LogicNode);
}
