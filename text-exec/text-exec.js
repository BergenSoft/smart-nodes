module.exports = function (RED)
{
    const ignoreWords = ["bitte", "schalte", "der", "die", "das", "dem", "den", "in", "im", "bei", "beim", "am", "alle",
        "please", "switch", "turn", "the", "at", "by", "in", "all"]

    function TextExecNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        node.status({});

        let log = [];

        node.on("input", function (msg)
        {
            let mode = "light"; // light || shutter
            let action = null; // on || off || up || stop || down
            let message = null;

            if (typeof msg.payload == "string")
            {
                message = msg.payload;
            }
            else if (typeof msg.payload?.event?.command == "string")
            {
                message = msg.payload?.event?.command;
            }

            // Check if message was found
            if (typeof message != "string")
            {
                node.error("Couldn't detect sended message");
                return;
            }

            node.status({ fill: "green", shape: "dot", text: message });
            log = [];

            let searchWords = [];
            for (const word of message.toLowerCase().trim().split(/[\s,.]+/).filter(w => !ignoreWords.includes(w)))
            {
                switch (word)
                {
                    case "licht":
                    case "steckdose":
                    case "light":
                    case "power":
                    case "outlet":
                        // node.log("Set mode to light");
                        mode = "light";
                        break;

                    case "rollladen":
                    case "rolladen":
                    case "beschattung":
                    case "fenster":
                    case "cover":
                    case "shutter":
                    case "shading":
                    case "window":
                    case "windows":
                        // node.log("Set mode to shutter");
                        mode = "shutter";
                        break;

                    case "an":
                    case "on":
                    case "ein":
                    case "einschalten":
                        // node.log("Set action to on");
                        action = "on";
                        break;

                    case "aus":
                    case "off":
                    case "ausschalten":
                        // node.log("Set action to off");
                        action = "off";
                        break;

                    case "hoch":
                    case "up":
                    case "auf":
                    case "öffne":
                    case "open":
                        // node.log("Set action to up");
                        action = "up";
                        break;

                    case "runter":
                    case "down":
                    case "ab":
                    case "schließe":
                    case "close":
                        // node.log("Set action to down");
                        action = "down";
                        break;

                    case "stoppe":
                    case "stop":
                        // node.log("Set action to stop");
                        action = "stop";
                        break;

                    case "und":
                    case "and":
                        if (performAction(mode, action, searchWords))
                        {
                            action = null;
                            searchWords = [];
                        }
                        break;

                    default:
                        searchWords.push(word);
                        break;
                }
            }

            performAction(mode, action, searchWords);

            // Show what happened in debug bar
            // node.warn(log);
        });

        let findMatchingNodes = (mode, searchWords) =>
        {
            let result = [];

            config.links.forEach(link =>
            {
                let linkedNode = RED.nodes.getNode(link);

                if (linkedNode && linkedNode.exec_text_names != "")
                {
                    if (mode == "light" && !["smart_light-control", "smart_scene-control"].includes(linkedNode.type))
                        return;

                    if (mode == "shutter" && !["smart_shutter-control", "smart_shutter-complex-control"].includes(linkedNode.type))
                        return;

                    let names = linkedNode.exec_text_names.trim().split(/[\s,]+/).map(txt => txt.toLowerCase());
                    if (searchWords.filter(n => names.indexOf(n) != -1).length > 0)
                        result.push(linkedNode);
                }
            });

            return result;
        }

        let performAction = (mode, action, searchWords) =>
        {
            if (action != null && searchWords.length > 0)
            {
                // node.log("Search for " + searchWords.length + " nodes");

                let nodes = findMatchingNodes(mode, searchWords);
                if (nodes.length > 0)
                {
                    nodes.forEach(node =>
                    {
                        RED.events.emit("node:" + node.id, { "topic": action });
                    });

                    log.push({ mode, action, searchWords, foundNodes: nodes.length });
                }

                return true;
            }

            return false;
        }
    }
    RED.nodes.registerType("smart_text-exec", TextExecNode);
};
