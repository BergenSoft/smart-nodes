module.exports = function (RED)
{
    function LogicNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smartContext = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        // dynamic config
        let logic = config.logic;
        let out_true = helper.evaluateNodeProperty(RED, config.out_true, "json");
        let out_false = helper.evaluateNodeProperty(RED, config.out_false, "json");
        let logic_inputs = config.logic_inputs;
        let inverts = config.inverts.split(",").map(n => parseInt(n));
        let invert_output = config.invert_output;

        // runtime values


        var nodeSettings = {
            input_states: Array.from({ length: logic_inputs }).fill(false),
            last_message: null,
        };

        if (config.save_state)
        {
            // load old saved values
            nodeSettings = Object.assign(nodeSettings, smartContext.get(node.id));
        }
        else
        {
            // delete old saved values
            smartContext.del(node.id);
        }

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
                nodeSettings.input_states[input - 1] = !msg.payload;
            else
                nodeSettings.input_states[input - 1] = !!msg.payload; // !! => Convert to boolean

            setStatus();
            let result = getResult();

            if (invert_output ? !result : result)
            {
                result = out_true;
                result.payload = true;
            }
            else
            {
                result = out_false;
                result.payload = false;
            }

            if (nodeSettings.last_message?.payload != result.payload)
            {
                nodeSettings.last_message = result;

                node.send(result);
            }

            if (config.save_state)
                smartContext.set(node.id, nodeSettings);
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
                        const element = nodeSettings.input_states[i];
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
                        const element = nodeSettings.input_states[i];
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
                        const element = nodeSettings.input_states[i];
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
                const element = nodeSettings.input_states[i];

                state.push((invert ? "!" + (!element) : "" + element));
            }

            let result = getResult();
            let resultText = (invert_output ? "!" : "") + result;

            node.status({ fill: "yellow", shape: "ring", text: "[" + state.join(", ") + "] => " + resultText });
        }

        if (config.save_state && config.resend_on_start && nodeSettings.last_message != null)
        {
            setTimeout(() =>
            {
                node.send(nodeSettings.last_message);
            }, 10000);
        }

        setStatus();
    }

    RED.nodes.registerType("smart_logic", LogicNode);
}
