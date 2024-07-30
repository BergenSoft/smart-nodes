module.exports = function (RED)
{
    "use strict";

    function HysteresisNode(config)
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
            smart_context.del(node.id);
        }


        // ##################
        // # Dynamic config #
        // ##################
        let out_higher = helper.evaluateNodeProperty(RED, config.out_higher, config.out_higher_type);
        let out_lower = helper.evaluateNodeProperty(RED, config.out_lower, config.out_lower_type);
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
            let real_topic = helper.getTopicName(msg.topic);
            let value = parseFloat(msg.payload);

            if (isNaN(value))
            {
                // helper.warn(this, "Invalid payload: " + msg.payload);
                return;
            }

            switch (real_topic)
            {
                case "setpoint":
                    node_settings.setpoint = value;
                    break;

                case "hysteresis":
                    node_settings.hysteresis = value;
                    break;

                default:
                    node_settings.last_value = value
                    break;
            }

            // Always calculate new result
            let result = getResult(node_settings.last_value);
            let out_msg = null;

            // No change, nothing to send
            if (result === null)
                return;

            // Get custom output message
            if (result)
                out_msg = createMessage(out_higher, config.out_higher_type, msg, node_settings.last_value);
            else
                out_msg = createMessage(out_lower, config.out_lower_type, msg, node_settings.last_value);

            // Overwrite automatic values, if not already defined
            if (typeof out_msg.payload === "undefined")
                out_msg.payload = result ?? node_settings.last_result;

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

            node_settings.last_result = result;
            node_settings.last_message = out_msg;
        }

        let getResult = value =>
        {
            if (value >= node_settings.setpoint + node_settings.hysteresis && node_settings.last_result !== true)
                return true;

            if (value <= node_settings.setpoint - node_settings.hysteresis && node_settings.last_result !== false)
                return false;

            if (send_only_change)
                return null;

            return node_settings.last_result;
        }

        let setStatus = () =>
        {
            if (node_settings.last_result == null)
                node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": ❓ S: " + node_settings.setpoint + " - H: " + node_settings.hysteresis + " - V: null" });
            else
                node.status({ fill: node_settings.last_result ? "green" : "red", shape: "dot", text: helper.getCurrentTimeForStatus() + ": " + (node_settings.last_result ? "⬆️" : "⬇️") + " S: " + node_settings.setpoint + " - H: " + node_settings.hysteresis + " - V: " + node_settings.last_value?.toFixed(2) });
        }

        let createMessage = (out_msg, out_type, msg, value) =>
        {
            return helper.cloneObject(out_type == "NOTHING" ? msg : out_msg, {
                smart_info: {
                    last_result: node_settings.last_result,
                    hysteresis: node_settings.hysteresis,
                    setpoint: node_settings.setpoint,
                    last_value: node_settings.last_value,
                    value: value
                }
            });
        };

        if (config.save_state && config.resend_on_start && node_settings.last_result !== null && node_settings.last_message !== null)
        {
            setTimeout(() =>
            {
                if (outputs == 2)
                {
                    if (node_settings.last_result)
                        node.send([helper.cloneObject(node_settings.last_message), null]);
                    else
                        node.send([null, helper.cloneObject(node_settings.last_message)]);
                }
                else
                {
                    node.send(helper.cloneObject(node_settings.last_message));
                }
            }, 10000);
        }

        setStatus();
    }

    RED.nodes.registerType("smart_hysteresis", HysteresisNode);
}
