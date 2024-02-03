module.exports = function (RED)
{
    function StatisticNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smartContext = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        var nodeSettings = {
            values: [],
            lastMessage: null,
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

        // dynamic config
        let operation = config.operation
        let count = config.count;

        // runtime values


        node.on("input", function (msg)
        {
            if (isNaN(parseFloat(msg.payload)))
            {
                // node.error("Invalid payload: " + msg.payload);
                return;
            }

            let realTopic = helper.getTopicNumber(msg.topic) || 0;
            // realTopic should be sended with 1-based, but internally 0-based is needed
            realTopic--;

            if (operation === "MOV_AVG")
            {
                nodeSettings.values.push(parseFloat(msg.payload));
                if (nodeSettings.values.length > count)
                    nodeSettings.values.splice(0, 1);
            }
            else if (operation != "ABS")
            {
                if (typeof msg.topic === "undefined")
                {
                    node.error("Topic not set");
                    return;
                }
                nodeSettings.values[realTopic] = parseFloat(msg.payload);
            }

            msg = getResult(msg);
            setStatus(msg);

            if (msg)
            {
                nodeSettings.lastMessage = msg;
                node.send(msg);
            }

            if (config.save_state)
                smartContext.set(node.id, nodeSettings);
        });

        node.on("close", function ()
        {
        });

        let getResult = (msg) =>
        {
            let length;
            if (operation !== "MOV_AVG" && operation !== "ABS") 
            {
                length = Object.entries(nodeSettings.values).length;
                if (length == 0)
                    return null;
            }

            let result = null;
            switch (operation)
            {
                case "MIN":
                    result = Object.entries(nodeSettings.values).reduce((v1, v2) =>
                    {
                        if (v1[1] <= v2[1])
                            return v1;
                        return v2;
                    });
                    break;

                case "MAX":
                    result = Object.entries(nodeSettings.values).reduce((v1, v2) =>
                    {
                        if (v1[1] >= v2[1])
                            return v1;
                        return v2;
                    });
                    break;

                case "SUM":
                    result = Object.entries(nodeSettings.values).reduce((v1, v2) =>
                    {
                        return [null, v1[1] + v2[1]];
                    });
                    break;

                case "DIFF":
                    if (nodeSettings.values.length >= 2)
                    {
                        result = [
                            null,
                            nodeSettings.values[0] - nodeSettings.values[1]
                        ];
                    }
                    break;

                case "ABS":
                    msg.payload = Math.abs(msg.payload);
                    return msg;

                case "ABS_DIFF":
                    if (nodeSettings.values.length >= 2)
                    {
                        result = [
                            null,
                            Math.abs(nodeSettings.values[0] - nodeSettings.values[1])
                        ];
                    }
                    break;

                case "AVG":
                    let value = Object.entries(nodeSettings.values).reduce((v1, v2) =>
                    {
                        return [null, v1[1] + v2[1]];
                    });

                    return {
                        payload: value[1] / length
                    };

                case "MOV_AVG":
                    msg.payload = nodeSettings.values.reduce((v1, v2) => v1 + v2) / nodeSettings.values.length;
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
                node.status({ fill: "yellow", shape: "ring", text: operation + " => " + msg.payload });
            else
                node.status({ fill: "yellow", shape: "ring", text: operation + "(" + Object.entries(nodeSettings.values).map(v => v[1]).join(",") + ") => " + msg.payload });
        }

        if (config.save_state && config.resend_on_start && nodeSettings.lastMessage != null)
        {
            setTimeout(() =>
            {
                node.send(nodeSettings.lastMessage);
            }, 10000);
        }

        setStatus(nodeSettings.lastMessage);
    }

    RED.nodes.registerType("smart_statistic", StatisticNode);
}
