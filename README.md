# General information

The smart nodes was created to control smart home devices like lights, power outlets shutter and some more.
This nodes are designed to work with the [node-red-contrib-knx-ultimate](https://github.com/Supergiovane/node-red-contrib-knx-ultimate) but it could also work with other smart technologies.

The knx binary input and output/switching modules should be configured very stupid. Closing a binary input should output 1 and releasing 0.
Same for the output/switching modules, 1 should turn on and 0 turn out. That makes it easy to count the presses or check for short and long presses.
Some node has to filter out the binary inputs if they goes to 0 or in other words, if `msg.payload == false`. Please see the internal node documentation then this signals are ignored. As an example sending a toggle topic for closing an input and also for releasing would toggle a light twice.

Sometimes one source node should be connected to multiple smart nodes which requires different topics.
To avoid requiring many change nodes, the smart node are using a special `msg.topic` notation. You can always send topics in the format `name#number`, e.g. `toggle#1`.
Smart nodes that requires a name are using only the name part. the # and the number are optional. Smart nodes that requries a number will only use the number, the name and # is also optional.

This is usefull when one node provide information to e.g. a light control node, as well as to a logic node.

This file only describes the general function of the node. See the documentation shown in NodeRed to find out how to use them, or see the included example flows.
As I'm german, the internal documentation is only available in german. If you need another language, feel free to add localizations and adding more languages via a pull request.

# Nodes

## 1. Light control

This node is able to control a light or a power outlet.

### **Features:**

-   Auto turn off the light after a fixed time.
-   Auto turn off the light with a custom time which is part of the message object.
-   Toggle light between on and off.
-   Can be triggered by motion sensors.
-   Has an alarm function to go to a specific state (on or off) when the alarm is activated.

## 2. Shutter control

This node is able to control a shutter.
There is no support for slats and it is also not planned as I don't need them, but feel free to send a pull request.

### **Features:**

-   One button control which switch between `up`, `stop`, `down`, `stop`.
-   One button control for each direction `up and stop` or `down and stop`.
-   Send direct position the shutter should be.
-   Stop shutter immediately.
-   Has an alarm function to go to a specific state (Open or close) when the alarm is activated.

## 3. Scene control

This node is tracking the state of multiple outputs and controls them by switching to multiple defined scenes.

### **Features:**

-   An input message could name multiple scenes that should be iterated one by one by receiving the same message multiple times

## 4. Central control

This node can control multiple light/scene controls or shutter controls at the same time

### **Features:**

-   Take care that multiple light/scene controls are turned of if any of them is one before executing a toggle command. This is helpful to avoid turning one light on and the other off.
-   The same is used for shutters with the up_stop or down_stop commands. A toggle is not supported, it will only be forwarded.

## 5. Long press control

This node is used to detect a short or a long press.
The time can be configured in this node.

### **Features:**

-   Imediately send a message to the long press output when the time is reached. It is not waiting until the button is released.

## 6. Multi press control

This node is used to detect multiple presses on a button.
The max wait time between presses can be configured in this node.
You can also choose 2-4 press detection.

### **Features:**

-   Imediately send a message to the last output when the max presses are reached. It is not waiting until the button is released.

## 7. Hysteresis

This node is checking if the input value reachs a defined value until the upper message is send. When the lower level is reached, the lower masssage will be send

### **Features:**

-   The state can be saved between NodeRed restarts.
-   The last message can automatically be sent 10 seconds after a deployment.

## 8. Logic

This node can be used for AND, OR and XOR logics.

### **Features:**

-   All input values could be individual converted as well as the output messsage.
-   A NOT logic is possible when selecting 1 input and convert the output.
-   The setpoint and hysteresis value can be changed in runtime.
-   The state can be saved between NodeRed restarts.
-   The last message can automatically be sent 10 seconds after a deployment.

## 9. Statistic

This node can be used for getting the following types of values: Minimum, Maximum, Sum, Difference, Absolute Value, Absolute Difference, Average and Running average.

### **Features:**

-   All input values could be individual converted as well as the output messsage.
-   A NOT logic is possible when selecting 1 input and convert the output.
-   The state can be saved between NodeRed restarts.
-   The last message can automatically be sent 10 seconds after a deployment.

## 10. Compare

This node can compare 2 values with the following operators: < <= == >= > !=

### **Features:**

-   Can compare also texts like js would do.
-   The state can be saved between NodeRed restarts.
-   The last message can automatically be sent 10 seconds after a deployment.

## 11. Delay

This node can delay incomming messages.

### **Features:**

-   Different times for `msg.payload = true` and `msg.payload = false`.
-   Delays can be changed in runtime.
-   The state can be saved between NodeRed restarts.
-   The last message can automatically be sent 10 seconds after a deployment.

## 12. Forwarder

This node can control if an incomming message should be forwarded or not.

### **Features:**

-   The forwarding can be enabled or disabled in runtime.
-   The state can be saved between NodeRed restarts.
-   The last message can automatically be sent 10 seconds after a deployment.

## 13. Scheduler

This node can send a defined message on defined times.

### **Features:**

-   The weekdays and the time can be selected as a trigger.
-   Multiple trigger and messages can be defined in one node.
-   The scheduler can be activated or deactivated in runtime.
-   The state can be saved between NodeRed restarts.
-   The last message can automatically be sent 10 seconds after a deployment.

## 14. Text execution

This node parses a text and performs actions to the selected and matching smart nodes

### **Features:**

-   Control light and scenes (only on or off) in german and english.
-   Control shutter in german and english.

### Examples

[ text ] is optional

-   Turn on [the light in] the living room and the kitchen off.
-   Open [the shutter in] the kitchen and turn studio off.
-   Close [the shutter in the] sleeping room.
-   Living room to 10 %.
-   Turn on living room except the couch light.
-   Sends debug message to output.

## 15. Mixing valve

This node can control a mixing valve to get the required tput temperature. It is working for heating and cooling.

### **Features:**

-   Define target temperature.
-   Support heating and cooling.
-   Define off mode to do nothing, open or close the valve.

## 16. Heating curve

This node calculates the needed flow temperature regarding to the target room temperature and the current outside temperature.

### **Features:**

-   Define slope and offset values.
-   Limit flow temperature with min and max values.
-   Preview of different curves in the node editor.

## 17. Counter

This node countes up and down within a specified range.

### **Features:**

-   Define min, max and step values.
-   Set to a specific value
-   Increment and decrement by default or by a given value.
