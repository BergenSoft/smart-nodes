module.exports = function (RED)
{
    "use strict";

    function TextExecNode(config)
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


        // ##################
        // # Runtime values #
        // ##################

        // Here the ouput message for logging purposes is saved.
        // It will be cleared with every new node input
        let log = null;

        // Holds a list with all room names, sorted from the longest to the shortest
        // Format: Index => RoomName
        let rooms = [];

        // Holds references to the nodes to access them by room name
        // Format: RoomName => [Node1, Node2, ..., NodeX]
        let lookup = new Map();


        node.status({});


        // ###############
        // # Node events #
        // ###############
        node.on("input", function (msg)
        {
            let mode = "light"; // light || shutter
            let action = null; // on || off || up || stop || down
            let number = null;
            let without = false;

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

            node.status({ fill: "green", shape: "dot", text: helper.getCurrentTimeForStatus() + ": " + message });
            log = {
                rooms: rooms,
                lookup: lookup,
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
                            without = false;
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
                            without = false;
                        }
                        break;

                    case "hoch":
                    case "oben":
                    case "up":
                    case "auf":
                    case "öffne":
                    case "open":
                        // node.log("Set action to up");
                        mode = "shutter";
                        action = "up";
                        break;

                    case "runter":
                    case "unten":
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
                    case "stopp":
                    case "stop":
                    case "anhalten":
                        // node.log("Set action to stop");
                        mode = "shutter";
                        action = "stop";
                        break;

                    case "außer":
                    case "ohne":
                    case "without":
                    case "but":
                    case "except":
                        without = true;
                        break;

                    case "und":
                    case "and":
                        if (performAction(mode, action, number, affectedNodes))
                        {
                            action = null;
                            affectedNodes = [];
                            number = null;
                            without = false;
                        }
                        break;

                    default:
                        if (word[0] == "$")
                        {
                            // node.log("Found word " + word);

                            let room = rooms[parseInt(word.substring(1), 10)];
                            // node.log("Found room " + room);

                            if (lookup.has(room))
                            {
                                for (const node of lookup.get(room))
                                {
                                    if (without && affectedNodes.includes(node))
                                        affectedNodes.splice(affectedNodes.indexOf(node), 1);
                                    else if (!without && !affectedNodes.includes(node))
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

        node.on("close", function ()
        {
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
                            // node.log("Add room: " + name);
                            if (!lookup.has(name))
                                lookup.set(name, []);

                            if (!lookup.get(name).includes(linkedNode))
                                lookup.get(name).push(linkedNode);

                            if (!rooms.includes(name))
                            {
                                // node.log("Add room to room list: " + name);
                                rooms.push(name);
                            }
                            break;

                        default:
                            break;
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
                message = message.replaceAll(room, "$" + index);
            }

            return message;
        }

        let performAction = (mode, action, number, affectedNodes) =>
        {
            if (action != null && affectedNodes.length > 0)
            {
                for (const targetNode of affectedNodes)
                {
                    if (mode == "light" && !["smart_light-control", "smart_scene-control"].includes(targetNode.type))
                        continue;

                    if (mode == "shutter" && !["smart_shutter-control", "smart_shutter-complex-control"].includes(targetNode.type))
                        continue;

                    // node.log("Notify node " + node.id);
                    if (action == "position")
                    {
                        // console.log({ "topic": action, "payload": number });
                        if (number != null)
                        {
                            // console.log(node.id + " -> " + targetNode.id);
                            // console.log({ "topic": action, "payload": number });
                            RED.events.emit("node:" + targetNode.id, { "topic": action, "payload": number });
                        }
                    }
                    else
                    {
                        // console.log(node.id + " -> " + targetNode.id);
                        // console.log({ "topic": action });
                        RED.events.emit("node:" + targetNode.id, { "topic": action });
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
