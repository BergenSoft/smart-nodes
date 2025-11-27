module.exports = function (RED)
{
    "use strict";

    function LogicNode(config)
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
            input_states: Array.from({ length: config.logic_inputs }).fill(false),
            last_result: null,
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
        let logic = config.logic;
        let out_true = helper.evaluateNodeProperty(RED, config.out_true, config.out_true_type || "json");
        let out_false = helper.evaluateNodeProperty(RED, config.out_false, config.out_false_type || "json");
        let logic_inputs = config.logic_inputs;
        let inverts = config.inverts.split(",").map(n => parseInt(n));
        let invert_output = config.invert_output;
        let send_only_change = helper.evaluateNodeProperty(RED, config.send_only_change, "bool");
        let outputs = helper.evaluateNodeProperty(RED, config.outputs, "num");


        // ##################
        // # Runtime values #
        // ##################


        // ###############
        // # Node events #
        // ###############
        node.on("input", function (msg)
        {
            handleTopic(msg);

            setStatus();

            if (config.save_state)
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
            helper.log(node, "handle topic:", msg);

            let real_topic_number = helper.getTopicNumber(msg.topic);

            if (real_topic_number == null || real_topic_number < 1 || real_topic_number > logic_inputs)    
            {
                node.error("Topic has to be >= 1 and <= " + logic_inputs + ", send: " + msg.topic);
                return;
            }

            if (inverts.includes(real_topic_number))
                node_settings.input_states[real_topic_number - 1] = !msg.payload;
            else
                node_settings.input_states[real_topic_number - 1] = !!msg.payload; // !! => Convert to boolean

            let result = getResult();

            helper.log(node, "getResult:", result, node_settings);

            let out_msg = null;

            setStatus();

            if (invert_output)
                result = !result;

            // Get custom output message
            if (result)
            {
                if (out_true !== null)
                    out_msg = helper.cloneObject(out_true);
            }
            else
            {
                if (out_false !== null)
                    out_msg = helper.cloneObject(out_false);
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
        }

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
                node.send(helper.cloneObject(node_settings.last_message));
            }, 10000);
        }

        setStatus();
    }

    RED.nodes.registerType("smart_logic", LogicNode);
}
