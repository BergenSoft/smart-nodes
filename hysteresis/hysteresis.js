
module.exports = function (RED)
{
    function HysteresisNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smartContext = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        var nodeSettings = {
            active: null,
            lastMessage: null,
            setpoint: parseFloat(config.setpoint),
            hysteresis: parseFloat(config.hysteresis)
        };

        if (config.save_state)
        {
            // load old saved values
            nodeSettings = Object.assign(nodeSettings, smartContext.get(node.id));

            switch (nodeSettings.active)
            {
                case true:
                    node.status({ fill: "green", shape: "dot", text: (new Date()).toLocaleString() + ": Load last state: Higher" });
                    break;

                case false:
                    node.status({ fill: "red", shape: "dot", text: (new Date()).toLocaleString() + ": Load last state: Lower" });
                    break;

                default:
                    node.status({ fill: "yellow", shape: "ring", text: (new Date()).toLocaleString() + ": No last state available" });
                    break;
            }
        }
        else
        {
            // delete old saved values
            node.status({});
            smartContext.del(node.id);
        }

        // dynamic config
        let out_higher = helper.evaluateNodeProperty(RED, config.out_higher, config.out_higher_type);
        let out_lower = helper.evaluateNodeProperty(RED, config.out_lower, config.out_lower_type);

        // runtime values

        node.on("input", function (msg)
        {
            let value = parseFloat(msg.payload);
            let realTopic = helper.getTopicName(msg.topic);

            if (isNaN(value) && realTopic !== "resend")
            {
                // node.error("Invalid payload: " + msg.payload);
                return;
            }

            switch (realTopic)
            {
                case "setpoint":
                    nodeSettings.setpoint = value;
                    node.status({ fill: nodeSettings.active ? "green" : "red", shape: "ring", text: (new Date()).toLocaleString() + ": New setpoint: " + value + "" });

                    if (config.save_state)
                        smartContext.set(node.id, nodeSettings);
                    break;

                case "hysteresis":
                    nodeSettings.hysteresis = value;
                    node.status({ fill: nodeSettings.active ? "green" : "red", shape: "ring", text: (new Date()).toLocaleString() + ": New hysteresis: " + value + "" });

                    if (config.save_state)
                        smartContext.set(node.id, nodeSettings);
                    break;

                case "resend":
                    if (nodeSettings.active === true && nodeSettings.lastMessage != null)
                    {
                        node.status({ fill: "green", shape: "dot", text: (new Date()).toLocaleString() + ": Resend higher value" });
                        node.send([nodeSettings.lastMessage, null]);
                    }
                    else if (nodeSettings.active === false && nodeSettings.lastMessage != null)
                    {
                        node.status({ fill: "red", shape: "dot", text: (new Date()).toLocaleString() + ": Resend lower value" });
                        node.send([null, nodeSettings.lastMessage]);
                    }
                    else
                    {
                        node.status({ fill: "yellow", shape: "ring", text: (new Date()).toLocaleString() + ": No resend, state is unknown" });
                    }
                    break;

                default:
                    if (value >= nodeSettings.setpoint + nodeSettings.hysteresis && nodeSettings.active !== true)
                    {
                        node.status({ fill: "green", shape: "dot", text: (new Date()).toLocaleString() + ": Turned higher by value " + value + "" });
                        nodeSettings.active = true;
                        nodeSettings.lastMessage = createMessage(out_higher ?? msg, value);

                        if (config.save_state)
                            smartContext.set(node.id, nodeSettings);

                        node.send([nodeSettings.lastMessage, null]);
                    }
                    else if (value <= nodeSettings.setpoint - nodeSettings.hysteresis && nodeSettings.active !== false)
                    {
                        node.status({ fill: "red", shape: "dot", text: (new Date()).toLocaleString() + ": Turned lower by value " + value + "" });
                        nodeSettings.active = false;
                        nodeSettings.lastMessage = createMessage(out_lower ?? msg, value);

                        if (config.save_state)
                            smartContext.set(node.id, nodeSettings);

                        node.send([null, nodeSettings.lastMessage]);
                    }
                    else
                    {
                        node.status({ fill: nodeSettings.active ? "green" : "red", shape: "ring", text: (new Date()).toLocaleString() + ": No change by value " + value + "" });
                    }
                    break;
            }
        });

        node.on("close", function ()
        {
        });

        let createMessage = (msg, value) =>
        {
            return Object.assign({}, msg, {
                smart_info: {
                    active: nodeSettings.active,
                    hysteresis: nodeSettings.hysteresis,
                    setpoint: nodeSettings.setpoint,
                    last_value: value
                }
            })
        };

        if (config.save_state && config.resend_on_start && nodeSettings.active != null && nodeSettings.lastMessage != null)
        {
            setTimeout(() =>
            {
                if (nodeSettings.active)
                    node.send([nodeSettings.lastMessage, null]);
                else
                    node.send([null, nodeSettings.lastMessage]);
            }, 10000);
        }
    }

    RED.nodes.registerType("smart_hysteresis", HysteresisNode);
}
