module.exports = function (RED)
{
    "use strict";

    function HysteresisNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        var node_settings = {
            active: null,
            last_message: null,
            setpoint: parseFloat(config.setpoint),
            hysteresis: parseFloat(config.hysteresis)
        };

        if (config.save_state)
        {
            // load old saved values
            node_settings = Object.assign(node_settings, smart_context.get(node.id));

            switch (node_settings.active)
            {
                case true:
                    node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Load last state: Higher" });
                    break;

                case false:
                    node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Load last state: Lower" });
                    break;

                default:
                    node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": No last state available" });
                    break;
            }
        }
        else
        {
            // delete old saved values
            node.status({});
            smart_context.del(node.id);
        }

        // dynamic config
        let out_higher = helper.evaluateNodeProperty(RED, config.out_higher, config.out_higher_type);
        let out_lower = helper.evaluateNodeProperty(RED, config.out_lower, config.out_lower_type);

        // runtime values

        node.on("input", function (msg)
        {
            let value = parseFloat(msg.payload);
            let real_topic = helper.getTopicName(msg.topic);

            if (isNaN(value) && real_topic !== "resend")
            {
                // node.error("Invalid payload: " + msg.payload);
                return;
            }

            switch (real_topic)
            {
                case "setpoint":
                    node_settings.setpoint = value;
                    node.status({ fill: node_settings.active ? "green" : "red", shape: "ring", text: helper.getCurrentTimeForStatus() + ": New setpoint: " + value + "" });

                    if (config.save_state)
                        smart_context.set(node.id, node_settings);
                    break;

                case "hysteresis":
                    node_settings.hysteresis = value;
                    node.status({ fill: node_settings.active ? "green" : "red", shape: "ring", text: helper.getCurrentTimeForStatus() + ": New hysteresis: " + value + "" });

                    if (config.save_state)
                        smart_context.set(node.id, node_settings);
                    break;

                case "resend":
                    if (node_settings.active === true && node_settings.last_message != null)
                    {
                        node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Resend higher value" });
                        node.send([node_settings.last_message, null]);
                    }
                    else if (node_settings.active === false && node_settings.last_message != null)
                    {
                        node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Resend lower value" });
                        node.send([null, node_settings.last_message]);
                    }
                    else
                    {
                        node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": No resend, state is unknown" });
                    }
                    break;

                default:
                    if (value >= node_settings.setpoint + node_settings.hysteresis && node_settings.active !== true)
                    {
                        node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Turned higher by value " + value + "" });
                        node_settings.active = true;
                        node_settings.last_message = createMessage(out_higher ?? msg, value);

                        if (config.save_state)
                            smart_context.set(node.id, node_settings);

                        node.send([node_settings.last_message, null]);
                    }
                    else if (value <= node_settings.setpoint - node_settings.hysteresis && node_settings.active !== false)
                    {
                        node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Turned lower by value " + value + "" });
                        node_settings.active = false;
                        node_settings.last_message = createMessage(out_lower ?? msg, value);

                        if (config.save_state)
                            smart_context.set(node.id, node_settings);

                        node.send([null, node_settings.last_message]);
                    }
                    else
                    {
                        node.status({ fill: node_settings.active ? "green" : "red", shape: "ring", text: helper.getCurrentTimeForStatus() + ": No change by value " + value + "" });
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
                    active: node_settings.active,
                    hysteresis: node_settings.hysteresis,
                    setpoint: node_settings.setpoint,
                    last_value: value
                }
            })
        };

        if (config.save_state && config.resend_on_start && node_settings.active != null && node_settings.last_message != null)
        {
            setTimeout(() =>
            {
                if (node_settings.active)
                    node.send([node_settings.last_message, null]);
                else
                    node.send([null, node_settings.last_message]);
            }, 10000);
        }
    }

    RED.nodes.registerType("smart_hysteresis", HysteresisNode);
}
