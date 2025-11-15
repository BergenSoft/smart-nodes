const { log } = require('console');

let instance = null;

module.exports = function (_RED)
{
    if (instance != null)
        return instance;

    let hasChanges = false;
    let inTestMode = _RED.settings.userDir == null;

    // used for local debugging
    if (inTestMode)
        console.log("####### Test Mode detected #######");

    const fs = require('fs');
    const pathLib = require('path');

    // Fallback, falls RED.settings.userDir in Tests nicht gesetzt ist
    const userDir = (_RED.settings && _RED.settings.userDir) ? _RED.settings.userDir : process.cwd();
    const filePath = pathLib.join(userDir, 'SmartNodesContext.json');

    let globalData = {};

    if (fs.existsSync(filePath))
    {
        try
        {
            let fileContent = fs.readFileSync(filePath, "utf8");
            globalData = Object.assign({}, JSON.parse(fileContent));

            if (inTestMode)
                console.log("Loaded:", globalData);
        }
        catch (error)
        {
            console.error("Couldn't read SmartNodesContext.json", error);
        }
    }

    // Autosave each 30 seconds if changes exists.
    let interval = setInterval(() =>
    {
        if (hasChanges)
            save();

    }, 30 * 1000);

    // Prevent the interval from keeping the process alive (important for Jest)
    if (interval && typeof interval.unref === "function")
        interval.unref();

    function save()
    {
        try
        {
            if (inTestMode)
                console.log("Save SmartNodeContext", globalData);

            fs.writeFile(filePath, JSON.stringify(globalData), err =>
            {
                if (err)
                    console.error(err);
            });
            hasChanges = false;
        }
        catch (error)
        {
            console.error("Couldn't write SmartNodesContext.json", error);
        }
    }

    function set(id, data)
    {
        hasChanges = true;
        globalData["id" + id] = data;

        if (inTestMode)
            save();
    }

    function get(id)
    {
        return globalData["id" + id];
    }

    function del(id)
    {
        hasChanges = true;
        delete globalData["id" + id];
    }

    function close()
    {
        if (interval)
        {
            clearInterval(interval);
            interval = null;
        }
    }

    instance = { set, get, del, close };
    return instance;
};