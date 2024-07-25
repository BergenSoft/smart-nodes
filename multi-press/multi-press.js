module.exports = function (RED)
{
    "use strict";

    function MultiPressControlNode(config)
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


        // ##################
        // # Dynamic config #
        // ##################
        let press_delay_ms = parseInt(config.press_delay_ms || 200, 10);
        let outs = [
            helper.evaluateNodeProperty(RED, config.out1, "json"),
            helper.evaluateNodeProperty(RED, config.out2, "json"),
            helper.evaluateNodeProperty(RED, config.out3, "json"),
            helper.evaluateNodeProperty(RED, config.out4, "json")
        ];


        // ##################
        // # Runtime values #
        // ##################

        // Count the number of current presses
        let count = 0;

        // Here the setTimeout return value is stored to detect end of multipress.
        let timeout = null;


        // ###############
        // # Node events #
        // ###############
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


        // #####################
        // # Private functions #
        // #####################
        /**
         * This function start/restarts the timer and increase the counter by one.
         */
        let startTimeout = () =>
        {
            count++;

            if (timeout != null)
            {
                clearTimeout(timeout);
                timeout = null;
            }

            // If maximum presses are detected, send result immediately
            // Otherwise start timeout
            if (count == config.outputs)
                sendResult();
            else
                timeout = setTimeout(() =>
                {
                    timeout = null;
                    sendResult();
                }, press_delay_ms);
        }

        /**
         * This function is called if the number of presses should be send to the output.
         */
        let sendResult = () =>
        {
            node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": Last was press " + count + " time" + (count == 1 ? "" : "s") });

            // Prepare data
            let data = Array.from({ length: config.outputs }).fill(null);
            // Send a copy of the defined json
            data[count - 1] = helper.cloneObject(outs[count - 1]);
            node.send(data);

            // Reset values
            count = 0;
            timeout = null;
        }
    }

    RED.nodes.registerType("smart_multi-press-control", MultiPressControlNode);
}
