module.exports = function (RED)
{
    "use strict";

    function StatisticNode(config)
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
            values: [],
            last_message: null,
        };


        // load or delete saved values
        if (config.save_state)
            node_settings = Object.assign(node_settings, smart_context.get(node.id));
        else
            smart_context.del(node.id);


        // ##################
        // # Dynamic config #
        // ##################
        let operation = config.operation
        let out_message = helper.evaluateNodeProperty(RED, config.out_message, config.out_message_type);
        let count = config.count;

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
            if (isNaN(parseFloat(msg.payload)))
            {
                // helper.warn(this, "Invalid payload: " + msg.payload);
                return;
            }

            let real_topic_number = helper.getTopicNumber(msg.topic) || 0;

            // real_topic_number should be sended with 1-based, but internally 0-based is needed
            real_topic_number--;

            if (operation === "MOV_AVG")
            {
                node_settings.values.push(parseFloat(msg.payload));
                if (node_settings.values.length > count)
                    node_settings.values.splice(0, 1);
            }
            else if (operation != "ABS")
            {
                if (typeof msg.topic === "undefined")
                {
                    node.error("Topic not set");
                    return;
                }
                node_settings.values[real_topic_number] = parseFloat(msg.payload);
            }

            msg = getResult(msg);
            setStatus(msg);

            if (msg)
            {
                // if out_message is set, use this instead of the default message
                if (out_message)
                    msg = helper.cloneObject(out_message, { payload: msg.payload });

                node_settings.last_message = helper.cloneObject(msg);
                node.send(node_settings.last_message);
            }
        }

        let getResult = (msg) =>
        {
            let length;
            if (operation !== "MOV_AVG" && operation !== "ABS") 
            {
                length = Object.entries(node_settings.values).length;
                if (length == 0)
                    return null;
            }

            let result = null;
            switch (operation)
            {
                case "MIN":
                    result = Object.entries(node_settings.values).reduce((v1, v2) =>
                    {
                        if (v1[1] <= v2[1])
                            return v1;
                        return v2;
                    });
                    break;

                case "MAX":
                    result = Object.entries(node_settings.values).reduce((v1, v2) =>
                    {
                        if (v1[1] >= v2[1])
                            return v1;
                        return v2;
                    });
                    break;

                case "SUM":
                    result = Object.entries(node_settings.values).reduce((v1, v2) =>
                    {
                        return [null, v1[1] + v2[1]];
                    });
                    break;

                case "DIFF":
                    if (node_settings.values.length >= 2)
                    {
                        result = [
                            null,
                            node_settings.values[0] - node_settings.values[1]
                        ];
                    }
                    break;

                case "ABS":
                    msg.payload = Math.abs(msg.payload);
                    return msg;

                case "ABS_DIFF":
                    if (node_settings.values.length >= 2)
                    {
                        result = [
                            null,
                            Math.abs(node_settings.values[0] - node_settings.values[1])
                        ];
                    }
                    break;

                case "AVG":
                    let value = Object.entries(node_settings.values).reduce((v1, v2) =>
                    {
                        return [null, v1[1] + v2[1]];
                    });

                    return {
                        payload: value[1] / length
                    };

                case "MOV_AVG":
                    msg.payload = node_settings.values.reduce((v1, v2) => v1 + v2) / node_settings.values.length;
                    return msg;
            }

            if (result != null)
            {
                if (Number.isNaN(result[1]) || !Number.isFinite(result[1]))
                    return null;

                if (result[0] == null)
                    return { payload: result[1] };

                return {
                    topic: result[0],
                    payload: result[1]
                };
            }

            return null;
        }

        let setStatus = (msg) =>
        {
            if (msg == null)
                return;

            if (operation === "ABS")
                node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": " + operation + " => " + msg.payload });
            else
                node.status({ fill: "yellow", shape: "ring", text: helper.getCurrentTimeForStatus() + ": " + operation + "(" + Object.entries(node_settings.values).map(v => v[1]).join(", ") + ") => " + msg.payload?.toFixed(2) });
        }

        if (config.save_state && config.resend_on_start && node_settings.last_message != null)
        {
            setTimeout(() =>
            {
                node.send(helper.cloneObject(node_settings.last_message));
            }, 10000);
        }

        setStatus(node_settings.last_message);
    }

    RED.nodes.registerType("smart_statistic", StatisticNode);
}
