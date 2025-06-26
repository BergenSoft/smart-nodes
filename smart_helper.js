module.exports = {

    /**
     * This functions converts a value into the given type.
     * If a type is unknown the NodeRed function is used for conversation.
     * 
     * Known types are:
     * - "NOTHING", which will return always null
     */
    evaluateNodeProperty(RED, value, type)
    {
        try
        {
            switch (type?.toUpperCase())
            {
                case null:
                case "NOTHING":
                    return null;

                default:
                    return RED.util.evaluateNodeProperty(value, type);
            }
        }
        catch (error)
        {
            console.error({ value, type, error });
            return null;
        }
    },

    /**
     * This functions returns the name that is set in a smart topic.
     * The format is name#number
     * 
     * If no name is found null is returned.
     */
    getTopicName(topic)
    {
        if (typeof topic == "undefined" || topic == null || topic == "" || typeof topic != "string")
            return null;

        if (topic.indexOf("#") == -1)
            return topic;

        return topic.substring(0, topic.indexOf("#"));
    },

    /**
     * This functions returns the number that is set in a smart topic.
     * The format is name#number
     * 
     * If no number is found null is returned.
     */
    getTopicNumber(topic)
    {
        if (typeof topic == "undefined" || topic == null || topic == "")
            return null;

        if (typeof topic == "string")
        {
            if (topic.indexOf("#") != -1)
                return parseInt(topic.substring(topic.indexOf("#") + 1), 10);
        }

        let result = parseInt(topic, 10);
        if (isNaN(result) || !isFinite(result))
            return null;

        return result;
    },

    /**
     * This functions extracts the topic name out of the given topic and checks if it is a valid topic.
     * If not, the default topic is returned.
     * @param {string} topic 
     * @param {string} defaultTopic 
     * @param {string[]} possibleTopics 
     * @returns The real topic that needs to be processes
     */
    getRealTopic(topic, defaultTopic, possibleTopics)
    {
        let realTopic = this.getTopicName(topic);
        if (possibleTopics.includes(realTopic))
            return realTopic;

        return defaultTopic;
    },

    /**
     * This function converts the given value with the given unit into milli seconds.
     * 
     * This units are available:
     *  - ms
     *  - s or sec
     *  - m or min
     *  - h
     */
    getTimeInMs(value, unit, defaultValue = 0)
    {
        value = parseFloat(value);
        if (isNaN(value) || value == 0)
            return defaultValue;

        switch (unit)
        {
            case "ms":
                return value;

            case "s":
            case "sec":
                return value * 1000;

            case "min":
                return value * 60 * 1000;

            case "h":
                return value * 3600 * 1000;
        }
    },

    /**
     * This function converts the given value with the given unit into seconds.
     * 
     * This units are available:
     *  - ms
     *  - s or sec
     *  - m or min
     *  - h
     */
    getTimeInS(value, unit)
    {
        value = parseInt(value, 10);
        if (isNaN(value) || value == 0)
            return 0;

        switch (unit)
        {
            case "ms":
                return value / 1000;

            case "s":
                return value;

            case "min":
                return value * 60;

            case "h":
                return value * 3600;
        }
    },

    /**
     * This function is parsing the given value and returns the time in milli seconds.
     * 
     * The string can have a number followed by an optional unit.
     * If no unit is given, the default is ms.
     * 
     * This units are available:
     *  - ms
     *  - s or sec
     *  - m or min
     *  - h
     */
    getTimeInMsFromString(value, defaultValue = 0)
    {
        // default in ms
        if (typeof value == "number")
            return value;

        if (typeof value != "string")
            return defaultValue;

        // Split 123min into ["123", "min"]
        let values = value.match(/^([0-9]+[,.]?[0-9]*)(ms|s|sec|m|min|h|)?$/);

        // string doesn't match
        if (values == null)
            return defaultValue;

        return this.getTimeInMs(values[1].replace(",", "."), values[2] || "ms", defaultValue);
    },

    /**
     * Formats a string by replacing {n} with the n-th argument.
     * Example: format("Hello {0}. {1} {0}.", "world", "Bye") => "Hello world. Bye world."
     * @param {string} str The string to format
     * @param  {...string} args The arguments used for the replacement
     * @returns The formatted string
     */
    format(str, ...args)
    {
        if (!args.length)
            return str;

        for (var a in args)
        {
            str = str.replace(new RegExp("\\{" + a + "\\}", "gi"), args[a]);
        }

        return str
    },

    /**
     * This function returns a string that represents the remaining time given in time_ms.
     * If a timeConcatWord it set, it returns also this word including the target time.
     */
    formatMsToStatus(time_ms, time_concat_word = null)
    {
        let result = "";

        if (time_concat_word)
        {
            let date = (new Date(Date.now() + time_ms));
            result = " " + time_concat_word + " " + date.getHours() + ":" + ("" + date.getMinutes()).padStart(2, "0") + ":" + ("" + date.getSeconds()).padStart(2, "0");
        }

        if (time_ms == 0)
            return "0:00" + result;

        // value in sec
        time_ms = parseInt(time_ms / 1000, 10);
        result = (time_ms % 60) + result;
        if (time_ms % 60 < 10)
            result = "0" + result;

        // value in min
        time_ms = parseInt(time_ms / 60, 10);
        result = (time_ms % 60) + ":" + result;
        if (time_ms % 60 < 10)
            result = "0" + result;

        // value in hour
        time_ms = parseInt(time_ms / 60, 10);
        result = (time_ms % 24) + ":" + result;
        if (time_ms % 24 < 10)
            result = "0" + result;

        // value in days
        time_ms = parseInt(time_ms / 24, 10);
        if (time_ms > 0)
            result = time_ms + "." + result;

        return result;
    },

    /**
     * This function returns a string that represents the remaining time until the given date.
     * If a time_concat_word it set, it returns also this word including the target time.
     */
    formatDateToStatus(date, time_concat_word = null)
    {
        let result = "";

        if (time_concat_word)
            result = " " + time_concat_word + " " + date.getHours() + ":" + ("" + date.getMinutes()).padStart(2, "0") + ":" + ("" + date.getSeconds()).padStart(2, "0");

        let value = date - new Date();
        if (value <= 0)
            return "0:00" + result;

        // value in sec
        value = parseInt(value / 1000, 10);
        result = (value % 60) + result;
        if (value % 60 < 10)
            result = "0" + result;

        // value in min
        value = parseInt(value / 60, 10);
        result = (value % 60) + ":" + result;
        if (value % 60 < 10)
            result = "0" + result;

        // value in hour
        value = parseInt(value / 60, 10);
        result = (value % 24) + ":" + result;
        if (value % 24 < 10)
            result = "0" + result;

        // value in days
        value = parseInt(value / 24, 10);
        if (value > 0)
            result = value + "." + result;

        return result;
    },

    /**
     * This function converts a number from a specific range into another range
     * E.g:
     *  Input range = 0 to 10
     *  Target range = 100 to 200
     * 
     *  current number = 0
     *  scale(5, 0, 10, 100, 200) => 100
     * 
     *  current number = 5
     *  scale(5, 0, 10, 100, 200) => 150
     * 
     *  current number = 10
     *  scale(5, 0, 10, 100, 200) => 200
     * 
     *  current number = 20 (out of input range!)
     *  scale(5, 0, 10, 100, 200) => 300 (out of output range!)
     */
    scale(number, inMin, inMax, outMin, outMax)
    {
        return (number - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
    },

    /**
     * This function returns a short string that represents the current date and time.
     */
    getCurrentDateForStatus()
    {
        let date = new Date();
        return date.getDate().toString().padStart(2, "0") + "." +
            (date.getMonth() + 1).toString().padStart(2, "0") + " - " +
            date.getHours().toString().padStart(2, "0") + ":" +
            date.getMinutes().toString().padStart(2, "0") + ":" +
            date.getSeconds().toString().padStart(2, "0");
    },

    /**
     * This function returns a short string that represents the current time.
     */
    getCurrentTimeForStatus()
    {
        let date = new Date();
        return date.getHours().toString().padStart(2, "0") + ":" +
            date.getMinutes().toString().padStart(2, "0") + ":" +
            date.getSeconds().toString().padStart(2, "0");
    },

    /**
     * This function returns a rounded number or null if it failed.
     */
    toFixed(value, fractionDigits)
    {
        try
        {
            return parseFloat(value).toFixed(fractionDigits);
        }
        catch
        {
            return null;
        }
    },

    /**
     * Creates a new independend object and copies all properties to the new one
     * @param {*} obj The Object to copy
     * @returns A new Object
     */
    cloneObject(...obj)
    {
        return Object.assign({}, ...obj);
    },

    /**
     * Forward all arguments to the console if it is enabled
     */
    log(node, ...args)
    {
        // uncomment to see all log values
        // console.log(node.constructor.name + " (" + node.id + "):", ...args);
    },

    /**
     * Forward all arguments to the console if it is enabled
     */
    warn(node, ...args)
    {
        // uncomment to see all warn values
        // console.warn(node.constructor.name + " (" + node.id + "):", ...args);
    }
};
