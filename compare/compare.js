module.exports = function (RED)
{
    function CompareNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smartContext = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        var nodeSettings = {
            values: [
                helper.evaluateNodeProperty(RED, config.value1, config.value1_type),
                helper.evaluateNodeProperty(RED, config.value2, config.value2_type)
            ],
            lastResult: null,
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
        let comparator = config.comparator;

        // runtime values

        node.on("input", function (msg)
        {
            // Check if topic has a valid value
            let input = helper.getTopicNumber(msg.topic);
            if (input == null || input < 1 || input > 2)    
            {
                node.error("Topic has to be 1 or 2, send: " + msg.topic);
                return;
            }

            // check if payload has a valid value
            let num = parseFloat(msg.payload);
            if (Number.isNaN(num))
            {
                node.error("Payload has to be numeric");
                return;
            }

            // Save new value
            nodeSettings.values[input - 1] = num;

            let result = getResult();
            setStatus(result);

            if (result != null)
            {
                nodeSettings.lastResult = result;

                if (config.save_state)
                    smartContext.set(node.id, nodeSettings);

                node.send({ payload: result, comparator: comparator });
            }
        });

        let getResult = () =>
        {
            // Wait until both values are set
            if (nodeSettings.values[0] == null || nodeSettings.values[1] == null)
                return null;

            switch (comparator)
            {
                case "SMALLER":
                    return nodeSettings.values[0] < nodeSettings.values[1];

                case "SMALLER_EQUAL":
                    return nodeSettings.values[0] <= nodeSettings.values[1];

                case "EQUAL":
                    return nodeSettings.values[0] === nodeSettings.values[1];

                case "UNEQUAL":
                    return nodeSettings.values[0] !== nodeSettings.values[1];

                case "GREATER_EQUAL":
                    return nodeSettings.values[0] >= nodeSettings.values[1];

                case "GREATER":
                    return nodeSettings.values[0] > nodeSettings.values[1];
            }

            return null;
        }

        // This is only used for status message
        let getComparatorSign = () =>
        {
            switch (comparator)
            {
                case "SMALLER":
                    return "<";

                case "SMALLER_EQUAL":
                    return "<=";

                case "EQUAL":
                    return "==";

                case "UNEQUAL":
                    return "!=";

                case "GREATER_EQUAL":
                    return ">=";

                case "GREATER":
                    return ">";
            }
            return "???";
        }

        // updates the status
        let setStatus = (result) =>
        {
            if (result == null)
                node.status({});
            else
                node.status({ fill: "yellow", shape: "ring", text: (new Date()).toLocaleString() + ": " + nodeSettings.values.join(" " + getComparatorSign() + " ") + " => " + result });
        }

        node.on("close", function ()
        {
        });

        if (config.save_state && config.resend_on_start && nodeSettings.lastResult != null)
        {
            setTimeout(() =>
            {
                node.send({ payload: nodeSettings.lastResult, comparator: comparator });
            }, 10000);
        }

        setStatus(nodeSettings.lastResult);
    }

    RED.nodes.registerType("smart_compare", CompareNode);
}
