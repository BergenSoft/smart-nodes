let instance = null;

module.exports = function (_RED)
{
    if (instance != null)
        return instance;

    let RED = _RED;
    let hasChanges = false;

    const fs = require('fs');
    const path = RED.settings.userDir + '/SmartNodesContext.json';

    let globalData = {};

    if (fs.existsSync(path))
    {
        try
        {
            let fileContent = fs.readFileSync(path, "utf8");
            globalData = Object.assign({}, JSON.parse(fileContent));
            // console.log("Loaded " + Object.keys(globalData).length + " smart_nodes config items");
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

    function save()
    {
        try
        {
            // console.log("Auto save");
            fs.writeFile(path, JSON.stringify(globalData), err =>
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

    instance = { set, get, del };
    return instance;
};