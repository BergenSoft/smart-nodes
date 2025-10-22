module.exports = function (RED)
{
    "use strict";

    function HeatingCurveNode(config)
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
        var node_settings = helper.cloneObject({
            room_setpoint: config.room_setpoint,
            flow_min: config.flow_min,
            flow_max: config.flow_max,
            temperature_outside: 10,
            last_flow_temperature: null
        }, smart_context.get(node.id));


        // ##################
        // # Dynamic config #
        // ##################
        let slope = parseFloat(config.slope);
        let offset = parseFloat(config.offset);


        // ##################
        // # Runtime values #
        // ##################


        // ###############
        // # Node events #
        // ###############
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
            switch (real_topic)
            {
                case "debug":
                    helper.nodeDebug(node, {
                        node_settings,
                        slope,                        
                        offset,
                    });
                    break;

                case "room_setpoint":
                    let new_setpoint = parseFloat(msg.payload);
                    if (isNaN(new_setpoint) && !isFinite(new_setpoint))
                    {
                        // helper.warn(this, "Invalid payload: " + msg.payload);
                        return;
                    }

                    node_settings.room_setpoint = new_setpoint;
                    break;

                case "temperature_outside":
                    let new_temp = parseFloat(msg.payload);
                    if (isNaN(new_temp) && !isFinite(new_temp))
                    {
                        // helper.warn(this, "Invalid payload: " + msg.payload);
                        return;
                    }

                    node_settings.temperature_outside = new_temp;
                    break;

                case "flow_min":
                    let new_flow_min = parseFloat(msg.payload);
                    if (isNaN(new_flow_min) && !isFinite(new_flow_min))
                    {
                        // helper.warn(this, "Invalid payload: " + msg.payload);
                        return;
                    }

                    node_settings.flow_min = new_flow_min;
                    break;

                case "flow_max":
                    let new_flow_max = parseFloat(msg.payload);
                    if (isNaN(new_flow_max) && !isFinite(new_flow_max))
                    {
                        // helper.warn(this, "Invalid payload: " + msg.payload);
                        return;
                    }

                    node_settings.flow_max = new_flow_max;
                    break;

                default:
                    node.error("Invalid topic: " + real_topic);
                    return;
            }
        }

        let sendResult = () =>
        {
            // Formula used was found here:
            // https://community.viessmann.de/t5/Gas/Mathematische-Formel-fuer-Vorlauftemperatur-aus-den-vier/td-p/68843

            let dar = node_settings.temperature_outside - node_settings.room_setpoint;
            node_settings.last_flow_temperature = node_settings.room_setpoint + offset - slope * dar * (1.4347 + 0.021 * dar + 247.9 * Math.pow(10, -6) * Math.pow(dar, 2));

            // console.log({
            //     set: node_settings.room_setpoint,
            //     offset,
            //     slope,
            //     dar,
            //     flow: node_settings.last_flow_temperature
            // });

            // Check borders
            node_settings.last_flow_temperature = Math.min(Math.max(node_settings.last_flow_temperature, node_settings.flow_min), node_settings.flow_max);
            smart_context.set(node.id, node_settings);

            node.send({ payload: node_settings.last_flow_temperature });
        }

        let setStatus = () =>
        {
            node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Out: " + node_settings.temperature_outside?.toFixed(1) + "°C, Flow: " + node_settings.last_flow_temperature?.toFixed(1) + "°C" });
        }

        if (node_settings.last_flow_temperature !== null)
            setTimeout(sendResult, 10000);

        setStatus();
    }

    RED.nodes.registerType("smart_heating-curve", HeatingCurveNode);
}
