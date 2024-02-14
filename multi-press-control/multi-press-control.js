module.exports = function (RED)
{
    function MultiPressControlNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const helper = require("../smart_helper.js");

        // dynamic config
        let press_delay_ms = parseInt(config.press_delay_ms || 200, 10);
        let outs = [
            helper.evaluateNodeProperty(RED, config.out1, "json"),
            helper.evaluateNodeProperty(RED, config.out2, "json"),
            helper.evaluateNodeProperty(RED, config.out3, "json"),
            helper.evaluateNodeProperty(RED, config.out4, "json")
        ];

        // runtime values
        let count = 0;
        let timeout = null;

        node.status({});

        node.on("input", function (msg)
        {
            if (msg.payload)
                startTimeout();
        });

        node.on("close", function ()
        {
            if (timeout != null)
            {
                clearTimeout(timeout);
                timeout = null;
            }
        });

        let startTimeout = () =>
        {
            count++;

            if (timeout != null)
            {
                clearTimeout(timeout);
                timeout = null;
            }

            if (count == config.outputs)
                sendResult();
            else
                timeout = setTimeout(sendResult, press_delay_ms);
        }

        let sendResult = () =>
        {
            node.status({ fill: "green", shape: "dot", text: (new Date()).toLocaleString() + ": Last was press " + count + " time" + (count == 1 ? "" : "s") });
            let data = Array.from({ length: config.outputs }).fill(null);
            data[count - 1] = outs[count - 1];
            node.send(data);
            count = 0;
            timeout = null;
        }
    }

    RED.nodes.registerType("smart_multi-press-control", MultiPressControlNode);
}
