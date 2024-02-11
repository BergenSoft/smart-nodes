module.exports = function (RED)
{
    function TextExecNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        node.status({});

        let log = [];
        let rooms = [];

        let lookup = [];

        node.on("input", function (msg)
        {
            let mode = "light"; // light || shutter
            let action = null; // on || off || up || stop || down
            let number = null;

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
            log = {
                actions: []
            };

            log.initMessage = message;
            message = prepareMessage(message);
            log.preparedMessage = message;

            let affectedNodes = [];
            for (const word of message.trim().split(/[\s,.]+/))
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
                        mode = "light";
                        action = "on";
                        if (performAction(mode, action, number, affectedNodes))
                        {
                            action = null;
                            affectedNodes = [];
                            number = null;
                        }
                        break;

                    case "aus":
                    case "off":
                    case "ausschalten":
                        // node.log("Set action to off");
                        mode = "light";
                        action = "off";
                        if (performAction(mode, action, number, affectedNodes))
                        {
                            action = null;
                            affectedNodes = [];
                            number = null;
                        }
                        break;

                    case "hoch":
                    case "up":
                    case "auf":
                    case "öffne":
                    case "open":
                        // node.log("Set action to up");
                        mode = "shutter";
                        action = "up";
                        break;

                    case "runter":
                    case "down":
                    case "ab":
                    case "schließe":
                    case "close":
                        // node.log("Set action to down");
                        mode = "shutter";
                        action = "down";
                        break;

                    case "prozent":
                    case "%":
                    case "percent":
                    case "percentage":
                        // node.log("Set action to position");
                        mode = "shutter";
                        action = "position";
                        break;

                    case "stoppe":
                    case "stop":
                    case "anhalten":
                        // node.log("Set action to stop");
                        mode = "shutter";
                        action = "stop";
                        break;

                    case "und":
                    case "and":
                        if (performAction(mode, action, number, affectedNodes))
                        {
                            action = null;
                            affectedNodes = [];
                            number = null;
                        }
                        break;

                    default:
                        if (word[0] == "$")
                        {
                            // node.log("Found word " + word);

                            let room = rooms[parseInt(word.substring(1), 10)];
                            // node.log("Found room " + room);

                            if (lookup[room] && Array.isArray(lookup[room]))
                            {
                                for (const node of lookup[room])
                                {
                                    if (!affectedNodes.includes(node))
                                        affectedNodes.push(node);
                                }
                            }
                        }
                        else if (isFinite(word))
                        {
                            number = parseInt(word, 10);
                            // node.log("Found number " + number);
                        }
                        else if (word[word.length - 1] == "%" && isFinite(word.substr(0, word.length - 1)))
                        {
                            number = parseInt(word.substr(0, word.length - 1), 10);
                            mode = "shutter";
                            action = "position";
                            // node.log("Found number " + number + " with %");
                        }
                        else
                        {
                            // node.log("Ignore word " + word);
                        }
                        break;
                }
            }

            performAction(mode, action, number, affectedNodes);

            // node.log("Finished");
            // node.log(log);

            // Show what happened in debug bar
            node.send(log);
        });

        /**
         * This function prepares a list of the rooms as well as the lookup tables for lights and shutters
         */
        let prepareRoomList = () =>
        {
            for (const link of config.links)
            {
                // node.log("Check node = " + link);
                let linkedNode = RED.nodes.getNode(link);

                if (linkedNode == null || linkedNode.exec_text_names == null || linkedNode.exec_text_names.length == 0)
                    continue;

                for (const name of linkedNode.exec_text_names)
                {
                    // console.log(linkedNode);
                    switch (linkedNode.type)
                    {
                        case "smart_light-control":
                        case "smart_scene-control":
                        case "smart_shutter-control":
                        case "smart_shutter-complex-control":
                            // node.log("Add room " + name);
                            if (!lookup[name])
                                lookup[name] = [];

                            if (!lookup[name].includes(linkedNode))
                                lookup[name].push(linkedNode);
                            break;

                        default:
                            break;
                    }

                    if (!rooms.includes(name))
                    {
                        // node.log("Add room " + name);
                        rooms.push(name);
                    }
                }
            }

            // Sort by length, longest names first
            rooms.sort((a, b) => b.length - a.length);

            // node.log(rooms);
            // console.log(lookup);
        }

        /**
         * This function replaces all rooms with a placeholder for the position within the rooms array
         * The reason for that is, that the names could contain spaces which won't work when splitting by a space.
         * 
         * e.g.: let rooms = ["Room 1", "Room 2"];
         * let message = "Turn on light in Room 1 and off in Room 2";
         * 
         * prepareMessage(message) will return "Turn on light in $0 and off in $1";
         */
        let prepareMessage = message =>
        {
            message = message.toLowerCase();
            for (let index = 0; index < rooms.length; index++)
            {
                const room = rooms[index];
                message = message.replace(room, "$" + index);
            }

            return message;
        }

        let performAction = (mode, action, number, affectedNodes) =>
        {
            if (action != null && affectedNodes.length > 0)
            {
                for (const node of affectedNodes)
                {
                    if (mode == "light" && !["smart_light-control", "smart_scene-control"].includes(node.type))
                        continue;

                    if (mode == "shutter" && !["smart_shutter-control", "smart_shutter-complex-control"].includes(node.type))
                        continue;

                    // node.log("Notify node " + node.id);
                    if (action == "position")
                    {
                        // console.log({ "topic": action, "payload": number });
                        if (number != null)
                            RED.events.emit("node:" + node.id, { "topic": action, "payload": number });
                    }
                    else
                    {
                        RED.events.emit("node:" + node.id, { "topic": action });
                    }
                }

                log.actions.push({ mode, action, nodes: affectedNodes.map(n => n.name || n.id) });
                return true;
            }

            return false;
        }

        setTimeout(() =>
        {
            prepareRoomList();
        }, 1000);
    }
    RED.nodes.registerType("smart_text-exec", TextExecNode);
};
