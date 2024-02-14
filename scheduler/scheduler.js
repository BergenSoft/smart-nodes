module.exports = function (RED)
{
    function SchedulerNode(config)
    {
        const node = this;
        RED.nodes.createNode(node, config);

        const smartContext = require("../persistence.js")(RED);
        const helper = require("../smart_helper.js");

        var nodeSettings = Object.assign({}, {
            enabled: config.enabled,
        }, smartContext.get(node.id));

        let timeouts = [];
        let nextEvents = [];

        setTimeout(() =>
        {
            for (let i = 0; i < config.schedules.length; i++)
            {
                const schedule = config.schedules[i];
                schedule.position = i + 1;
                schedule.message = helper.evaluateNodeProperty(RED, schedule.message, "json");
                schedule.days = schedule.days.split(",");
            }

            if (nodeSettings.enabled)
                initTimeouts();

            setStatus();
        }, 1000);


        node.on("input", function (msg)
        {
            switch (helper.getTopicName(msg.topic))
            {
                case "enable":
                    if (nodeSettings.enabled)
                        return;

                    nodeSettings.enabled = true;
                    break;

                case "disable":
                    if (!nodeSettings.enabled)
                        return;

                    nodeSettings.enabled = false;
                    break;

                case "set_state":
                    if (nodeSettings.enabled == !!msg.payload)
                        return;

                    nodeSettings.enabled = !!msg.payload;
                    break;

                default:
                    return;
            }

            if (nodeSettings.enabled)
                initTimeouts();
            else
                clearTimeouts();

            setStatus();
            smartContext.set(node.id, nodeSettings);
        });

        node.on("close", function ()
        {
            clearTimeouts();
        });

        let clearTimeouts = () =>
        {
            for (let i = 0; i < timeouts.length; i++)
            {
                if (timeouts[i] != 0)
                {
                    clearTimeout(timeouts[i]);
                    timeouts[i] = 0;
                }
            }
        }

        let initTimeouts = () =>
        {
            for (let i = 0; i < config.schedules.length; i++)
            {
                initTimeout(i, config.schedules[i]);
            }
        }

        let initTimeout = (i, schedule) =>
        {
            if (!nodeSettings.enabled)
                return;

            let waitTime = getWaitInMs(i, schedule);
            if (waitTime != null)
            {
                if (timeouts[i])
                    clearTimeout(timeouts[i]);

                timeouts[i] = setTimeout(raiseEvent, waitTime, i, schedule);
            }
        }

        let raiseEvent = (i, schedule) =>
        {
            if (!nodeSettings.enabled)
                return;

            timeouts[i] = 0;
            node.send(schedule.message);
            initTimeout(i, schedule);
            setStatus();
        }

        let getWaitInMs = (i, schedule) =>
        {
            // If no day is checked then we cannot it is never raised
            if (!schedule.days || schedule.days.length == 0)
                return null;

            let now = new Date();
            let findNextDay = false;

            // check if the time has already passed today
            if (now.getHours() > schedule.hour)
            {
                findNextDay = true;
            }
            else if (now.getHours() == schedule.hour)
            {
                if (now.getMinutes() > schedule.minute)
                {
                    findNextDay = true;
                }
                else if (now.getMinutes() == schedule.minute)
                {
                    findNextDay = now.getSeconds() >= schedule.second;
                }
            }

            // find next day when the event should be raised
            let possibleDays = schedule.days.filter(d => findNextDay ? d > now.getDay() : d >= now.getDay());
            if (possibleDays.length == 0)
                possibleDays = Math.min(...schedule.days);
            else
                possibleDays = Math.min(...possibleDays);

            let nextEvent = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate() + (
                    possibleDays < now.getDay() ? 7 - now.getDay() + possibleDays : possibleDays - now.getDay()
                ),
                schedule.hour,
                schedule.minute,
                schedule.second
            );

            nextEvents[i] = nextEvent;

            return nextEvent.getTime() - now.getTime();
        }

        let setStatus = () =>
        {
            if (!nodeSettings.enabled)
            {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: (new Date()).toLocaleString() + ": Scheduler disabled"
                });
            }
            else if (nextEvents.filter(d => d).lenght == 0)
            {
                node.status({
                    fill: "red",
                    shape: "dot",
                    text: (new Date()).toLocaleString() + ": No events planned"
                });
            }
            else
            {
                // filter out empty values
                let nextEvent = new Date(Math.min(...nextEvents.filter(d => d)));
                let time = nextEvent.getTime() - (new Date()).getTime();
                time = Math.ceil(time / 1000) * 1000;

                node.status({
                    fill: "yellow",
                    shape: "dot",
                    text: (new Date()).toLocaleString() + ": Wait " + helper.formatMsToStatus(time, "until") + " to raise next event"
                });
            }
        }

    }

    RED.nodes.registerType("smart_scheduler", SchedulerNode);
}