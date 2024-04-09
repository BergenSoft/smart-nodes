module.exports = function (RED)
{
    "use strict";

    function HysteresisNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smart_context = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        // persistant values
        var node_settings = {
            last_value: null,
            last_result: null,
            last_message: null,
            setpoint: parseFloat(config.setpoint),
            hysteresis: parseFloat(config.hysteresis)
        };

        if (config.save_state)
        {
            // load old saved values
            node_settings = Object.assign(node_settings, smart_context.get(node.id));

            switch (node_settings.last_result)
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
        let send_only_change = helper.evaluateNodeProperty(RED, config.send_only_change, "bool");
        let outputs = helper.evaluateNodeProperty(RED, config.outputs, "num");

        // runtime values

        node.on("input", function (msg)
        {
            let value = parseFloat(msg.payload);
            let real_topic = helper.getTopicName(msg.topic);

            if (isNaN(value))
            {
                // node.error("Invalid payload: " + msg.payload);
                return;
            }

            switch (real_topic)
            {
                case "setpoint":
                    node_settings.setpoint = value;
                    node.status({ fill: node_settings.last_result ? "green" : "red", shape: "ring", text: helper.getCurrentTimeForStatus() + ": New setpoint: " + value + "" });

                    if (config.save_state)
                        smart_context.set(node.id, node_settings);
                    break;

                case "hysteresis":
                    node_settings.hysteresis = value;
                    node.status({ fill: node_settings.last_result ? "green" : "red", shape: "ring", text: helper.getCurrentTimeForStatus() + ": New hysteresis: " + value + "" });

                    if (config.save_state)
                        smart_context.set(node.id, node_settings);
                    break;

                default:
                    let result = getResult(value);
                    let out_msg = null;

                    // Get custom output message
                    if (result)
                        out_msg = createMessage(out_higher, config.out_higher_type, msg, value);
                    else
                        out_msg = createMessage(out_lower, config.out_lower_type, msg, value);

                    // Overwrite automatic values, if not already defined
                    if (typeof out_msg.payload === "undefined")
                        out_msg.payload = result ?? node_settings.last_result;

                    // Send only if needed
                    if (send_only_change == false || node_settings.last_result != result)
                    {
                        // Separate outputs if needed
                        if (outputs == 2)
                        {
                            if (result)
                                out_msg = [out_msg, null];
                            else
                                out_msg = [null, out_msg];
                        }
                        else
                        {
                            node.send(out_msg);
                        }
                    }

                    node_settings.last_value = value;
                    node_settings.last_result = result;
                    node_settings.last_message = out_msg;

                    setStatus();

                    if (config.save_state)
                        smart_context.set(node.id, node_settings);
                    break;
            }
        });

        node.on("close", function ()
        {
        });

        let getResult = value =>
        {
            if (value >= node_settings.setpoint + node_settings.hysteresis && node_settings.last_result !== true)
                return true;

            if (value <= node_settings.setpoint - node_settings.hysteresis && node_settings.last_result !== false)
                return false;

            return null;
        }

        let setStatus = () =>
        {
            if (node_settings.last_result === true)
                node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Turned higher by value " + node_settings.last_value + "" });
            else if (node_settings.last_result === false)
                node.status({ fill: "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Turned lower by value " + node_settings.last_value + "" });
            else
                node.status({ fill: node_settings.last_result ? "green" : "red", shape: "ring", text: helper.getCurrentTimeForStatus() + ": No change by value " + node_settings.last_value + "" });
        }

        let createMessage = (out_msg, out_type, msg, value) =>
        {
            return Object.assign({}, out_type == "original" ? msg : out_msg, {
                smart_info: {
                    last_result: node_settings.last_result,
                    hysteresis: node_settings.hysteresis,
                    setpoint: node_settings.setpoint,
                    last_value: node_settings.last_value,
                    value: value
                }
            })
        };

        if (config.save_state && config.resend_on_start && node_settings.last_result != null && node_settings.last_message != null)
        {
            setTimeout(() =>
            {
                if (node_settings.last_result)
                    node.send([node_settings.last_message, null]);
                else
                    node.send([null, node_settings.last_message]);
            }, 10000);
        }
    }

    RED.nodes.registerType("smart_hysteresis", HysteresisNode);
}
