module.exports = function (RED)
{
    function LongPressControlNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const helper = require("../smart_helper.js");

        // dynamic config
        let long_press_ms = parseInt(config.long_press_ms || 1000, 10);
        let short = helper.evaluateNodeProperty(RED, config.short, "json");
        let long = helper.evaluateNodeProperty(RED, config.long, "json");

        // runtime values
        let on_time = null;
        let max_time_on_timeout = null;

        node.status({});

        node.on("input", function (msg)
        {
            if (msg.payload)
            {
                node.status({ fill: "yellow", shape: "ring", text: "Wait for button release..." });
                on_time = Date.now();
                startAutoLongPress();
            }
            else if (on_time != null)
            {
                const pressTime = Date.now() - on_time;
                on_time = null;

                // Stop if any timeout is set
                stopAutoOff();

                if (pressTime < long_press_ms)
                {
                    node.status({ fill: "green", shape: "dot", text: "Last was short" });
                    if (short)
                        node.send([short, null]);
                }
                else
                {
                    node.status({ fill: "green", shape: "dot", text: "Last was long" });
                    if (long)
                        node.send([null, long]);
                }
            }
        });

        let startAutoLongPress = () =>
        {
            stopAutoOff();
            max_time_on_timeout = setTimeout(() =>
            {
                on_time = null;
                node.status({ fill: "green", shape: "dot", text: "Last was long" });
                node.send([null, long]);
            }, long_press_ms);
        };

        let stopAutoOff = () =>
        {
            if (max_time_on_timeout != null)
            {
                node.status({});
                clearTimeout(max_time_on_timeout);
                max_time_on_timeout = null;
            }
        };
    }

    RED.nodes.registerType("smart_long-press-control", LongPressControlNode);
}
