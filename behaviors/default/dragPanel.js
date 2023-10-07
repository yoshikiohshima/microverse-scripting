/*

The panel is the container for blocks

blocks parent children relationship is maintained by itself and not rely on the worldcore parent children relationship. (When you pick a block up, it'd need to compute the transformation of all. Make the structure flat avoid this.

Then the code has to maintain the location of all subblocks
updated... but that is a good trade off, especially in a multi user
environment where you want to make changes as localized as possible.

A block that is picked up can avoid interaction with another user while being dragged.

A drop zone appears based on the block in "hand". The drop zone has
the user so only the user who caused it to show can drop it there. (it
means that two users can pop the drop zone at the same location. Which should be okay.)

the layout sets values in BlockActor and they create the pawn
Well, then, the actor side data structure would use the card

parent and children are used so use blockParent and blockChildren.

- when a block is first picked by a user U:

  teared handler figures out the block type of the top block
  -> create spots to test (still zero width and height but position)
  -> moveMap holds the information for the view.

  move by a user U:
  -> look for the drop zone that matches.
  -> if a spot is found, add a gray block that is the same size and layout.
  -> if a spot is left, remove the gray block.

 - when a block is moved:
  - checks if its pointer position go over a drop zone.
  - highlight the zone if necessary.

- when a block is dropped. if it was over the drop zone, drop it along with its friends.


- layout
- dropZone per user
- stick a dropzone when a user is moving  -> layout again
  -- change the target. layout gain
- drop layout

- the scale is sort of pixels in the model, but the appearance is in meters.
- layout should be robust and quick and take drop zone into account

- it needs to have a clear coordinate system where objects are not placed and sized from the center.

  The coordinates is in meters but measured from top left of the "top" element.

_cardData.spec.extent = {width, height, depth}
_cardData.spec.position = {x, y, z} // relative to the "top" element

fromPose(extent, position)
toPose(position)


*/

import {ActorBehavior, PawnBehavior} from "../PrototypeBehavior.d.ts";

class BlockSpecManagerActor extends ActorBehavior {
    setup() {
        if (!this._cardData.specs) {
            this.clearSpecs();
            this.addDefaultSpecs();
        }
    }

    clearSpecs() {
        this._cardData.specs = new Map();
    }

    addDefaultSpecs() {
        this._cardData.specs.set("turnBy", {
            blockType: " ", spec: ["turn by", "_Vector3", ":", "over", "_number"],
        });
        this._cardData.specs.set("translateBy", {
            blockType: " ", spec: ["translateBy", "_number", ":", "over", "_number"],
        });
    }

    addSpec(key, spec) {
        this._cardData.specs.set(key, spec);
    }

    removeSpec(key) {
        this._cardData.specs.delete(key);
    }

    specWithValues(props, values) {
        if (props.blockType === "cShape") {
            return {
                sentence: [{blockType: "cShapeHead", label: props.name}],
                strings: [props.name],
                ...props
            }
        }

        let spec = this._cardData.specs.get(props.name);
        if (!spec) {return {...props};}

        spec = spec.spec;

        let strings = new Set();

        let result = [];
        let i = 0;
        let v = 0;

        while (i < spec.length) {
            if (spec[i].startsWith("_")) {
                let str = values[v] !== undefined ? `${values[v]}` : "\u25A1";
                strings.add(str);
                result.push({
                    blockType: "literal",
                    value: values[v],
                    type: spec[i].slice(1)
                }); // vector 3 can be different types
                v++;
                i++;
            } else if (spec[i] === ":") {
                strings.add("\u25B6");
                strings.add("\u25C0");
                if (v < values.length) {
                    let str = "\u25C0";
                    strings.add(str);
                    result.push({
                        label: str,
                        blockType: "expander",
                        state: "expanded"});
                } else {
                    let str = "\u25B6";
                    strings.add(str);
                    result.push({
                        label: str,
                        blockType: "expander",
                        state: "expands"
                    });
                    return {sentence: result, strings, ...props};
                }
                i++;
            } else {
                strings.add(spec[i]);
                result.push({
                    blockType: "label",
                    label: spec[i]
                });
                i++;
            }
        }
        return {sentence: result, strings, ...props};
    }
}

class BlockPanelActor extends ActorBehavior {
    setup() {
        if (this.tools) {
            this.tools.forEach((t) => t.destroy());
        }
        this.tools = [];

        let block = this.createCard({
            translation: [-1, 0, 0.1],
            type: "object",
            behaviorModules: ["Spawner"],
            parent: this,
            noSave: true
        });

        this.tools.push(block);

        if (this._cardData.cardsMap) {
            for (let [k, _v] of this._cardData.cardsMap) {
                this.removeBlockHelper(k);
            }
        }

        this._cardData.target = [...this.service("ActorManager").actors].find(([_k, v]) => v.name === ("cube"))[0];

        this._cardData.extent = {width: 1024 / 128, height: 768 / 128};

        if (true/*!this.nextBlockId*/) {
            this._cardData.childrenMap = new Map(); // id of card -> [id of card]
            this._cardData.parentMap = new Map(); // id of card -> id of card
            this._cardData.cardsMap = new Map(); // blockId -> true // to be replaced with a set

            let top = this.insertBlock(null, this.createBlock({blockType: "top"}));
            let cShape = this.insertBlock(top, this.createBlock({blockType: "cShape", name: "together", fill: "#e0e0f0"}));

            this.insertBlock(cShape, this.createBlock({blockType: "command", name: "translateBy", fill: "#ffffff"}, [[3, 2, 1], 1]));
            this.insertBlock(cShape, this.createBlock({blockType: "command", name: "turnBy", fill: "#ffffff"}, [[1.5, 0, 0], 1]));
        }

        if (!this.dropZoneMap) {
            this.dropZoneMap = new Map(); // {viewId: dropZone.id}
        }

        this.listen("stringLayoutDone", "blockLayout");
        this.say("requestMeasurement");

        this.subscribe(this.id, "blockMoved", "blockMoved");
        this.subscribe(this.id, "blockTeared", "blockTeared");
        this.subscribe(this.id, "blockDropped", "blockDropped");
        this.subscribe(this.id, "blockReleased", "blockReleased");
        this.subscribe(this.id, "action", "action");
    }

    specWithValues(props, values) {
        return this.call("BlockSpecManager$BlockSpecManagerActor", "specWithValues", props, values);
    }

    /*setBlockSpecManager(manager) {
        this.manager = manager;
    }
    */

    fromPose(extent, position) {
        let my = this._cardData.extent;
        return [
            position[0] - my.width / 2 + extent.width / 2,
            -position[1] + my.height / 2 - extent.height / 2,
            position[2] / 32,
        ];
    }

    toPose(extent, rawPosition) {
        let my = this._cardData.extent;
        return [
            rawPosition[0] + my.width / 2 - extent.width / 2,
            -rawPosition[1] + my.height / 2 - extent.height / 2,
            rawPosition[2] * 32
        ];
    }

    addDropZone(info) {
        let zone = this.createBlock({blockType: "dropZone", dropType: "command"});

        this.insertBlock(info.owner, zone, info.info);
        return zone.id;
    }

    removeDropZone(info) {
        this.removeBlock(info.zoneId);
    }

    createBlock(props, values) {
        let spec = this.specWithValues(props, values);

        if (spec?.strings) {
            spec.strings.forEach((s) => {
                this._cardData.strings.set(s, null);
            });
        }
        let card = this.createCard({
            parent: this,
            noSave: true,
            panel: this.id,
            type: "object",
            behaviorModules: ["Block", "BlockDrag"],
            spec: spec
        });
        this._cardData.cardsMap.set(card.id, true);

        if (spec?.sentence) {
            if (spec.blockType === "cShape") {
                let behaviorModules = ["Block"];
                let color = 0xeeffee;
                let label = this.createCard({
                    parent: this,
                    noSave: true,
                    panel: this.id,
                    type: "object",
                    behaviorModules,
                    color,
                    spec: {blockType: "label", label: spec.sentence[0].label},
                });
                this._cardData.cardsMap.set(label.id, true);
                let goButton = this.createCard({
                    parent: this,
                    noSave: true,
                    panel: this.id,
                    type: "object",
                    behaviorModules: ["Block", "ActionButton"],
                    actionName: "go",
                    actionTarget: card.id,
                    spec: {blockType: "actionButton", actionName: "go"}
                });
                this._cardData.cardsMap.set(goButton.id, true);
                let stopButton = this.createCard({
                    parent: this,
                    noSave: true,
                    panel: this.id,
                    type: "object",
                    behaviorModules: ["Block", "ActionButton"],
                    actionName: "stop",
                    actionTarget: card.id,
                    spec: {blockType: "actionButton", actionName: "stop"}
                });
                this._cardData.cardsMap.set(stopButton.id, true);

                let head = this.createCard({
                    parent: this,
                    noSave: true,
                    panel: this.id,
                    type: "object",
                    behaviorModules: ["Block"],
                    color: 0xeeffee,
                    spec: {blockType: "cShapeHead"},
                });
                this._cardData.cardsMap.set(head.id, true);

                this._cardData.childrenMap.set(head.id, [label.id, goButton.id, stopButton.id]);
                this._cardData.parentMap.set(label.id, head.id);
                this._cardData.parentMap.set(goButton.id, head.id);
                this._cardData.parentMap.set(stopButton.id, head.id);

                this._cardData.childrenMap.set(card.id, [head.id]);
                this._cardData.parentMap.set(head.id, card.id);
            } else {
                let sentences = spec.sentence.map((s) => {
                    let behaviorModules = ["Block"];
                    let color;
                    if (spec.blockType === "cShape") {
                        color = 0xeeffee;
                    } else {
                        behaviorModules.push("BlockDrag");
                    }

                    let c = this.createCard({
                        parent: this,
                        noSave: true,
                        panel: this.id,
                        type: "object",
                        behaviorModules,
                        color,
                        spec: s
                    });
                    this._cardData.cardsMap.set(c.id, true);
                    return c.id;
                });
                this._cardData.childrenMap.set(card.id, sentences);
                sentences.forEach((s) => {
                    this._cardData.parentMap.set(s, card.id);
                });
            }
        }
        return card;
    }

    insertBlock(parentId, card, index) {
        // index === undefined -> insert last
        // index === 0 -> insert before the first
        // index === n -> insert before nth;
        // (index === n + 1) -> insert last
        if (parentId) {
            let ary = this._cardData.childrenMap.get(parentId);
            if (!ary) {
                ary = [];
                this._cardData.childrenMap.set(parentId, ary);
            }
            index = index === undefined ? ary.length : index;
            ary.splice(index, 0, card.id);
            this._cardData.parentMap.set(card.id, parentId);
        } else {
            this._cardData.topId = card.id;
        }

        return card.id;
    }

    getCard(id) {
        return this.service("ActorManager").actors.get(id);
    }

    removeBlock(blockId) {
        this.removeBlockHelper(blockId);
        this.blockLayout();
    }

    removeBlockHelper(blockId) {
        let card = this.getCard(blockId);
        if (card) {
            this.recursivelyRemoveBlock(blockId);
            let parentId = this._cardData.parentMap.get(blockId);
            if (parentId) {
                let children = this._cardData.childrenMap.get(parentId);
                if (children) {
                    let ind = children.indexOf(blockId);
                    if (ind >= 0) {
                        children.splice(ind, 1);
                    }
                }
            }
            card.destroy();
            this._cardData.parentMap.delete(blockId);
            this._cardData.cardsMap.delete(blockId);
        }
    }

    recursivelyRemoveBlock(blockId) {
        let children = this._cardData.childrenMap.get(blockId);
        if (children) {
            children.forEach((s) => {
                this.recursivelyRemoveBlock(s);
                this.removeBlockHelper(s);
            });
        }
    }

    blockLayout() {
        let top = this.getCard(this._cardData.topId);
        this.computeSize(top, 0);
        this.setPosition(top, [0, 0, 0]);
        this.publish(this.id, "blockLayout");
    }

    printSizes() {
        for (let [k, _v] of this._cardData.cardsMap) {
            let c = this.getCard(k);
            let spec = c._cardData.spec;
            console.log(c.id, spec.blockType, spec.width, spec.height);
        }
    }

    printPositions() {
        for (let [k, _v] of this._cardData.cardsMap) {
            let c = this.getCard(k);
            let spec = c._cardData.spec;
            console.log(spec.blockType, spec.position, spec.width, spec.height, c.translation);
        }
    }

    computeSize(card, nest) {
        // size is in meters
        let myWidth = 0;
        let myHeight = 0;
        let margin = 2 / 128;
        let marginTop = 0;
        let marginLeft = 0;
        let marginRight = 0;
        let marginBottom = 0;
        // initialize them to be zero
        let spec = card._cardData.spec;

        if (spec.blockType === "top") {
            let children = this._cardData.childrenMap.get(card.id);
            children.forEach((c) => {
                this.computeSize(this.getCard(c), nest + 1);
            });

            marginLeft = 0;
            marginTop = 0;
            marginBottom = 0;
            marginRight = 0;
            myWidth = this._cardData.extent.width; // meters
            myHeight = this._cardData.extent.height; // meters
        } else if (spec.blockType === "cShape") {
            let haveChildren = false;
            let children = this._cardData.childrenMap.get(card.id);
            if (children) {
                children.forEach((c) => {
                    haveChildren = true;
                    let {width, height} = this.computeSize(this.getCard(c), nest + 1);
                    myWidth = Math.max(myWidth, width);
                    myHeight += height + margin;
                });
            }
            marginLeft = 20 / 128;
            marginTop = 8 / 128;
            marginBottom = margin;
            marginRight = margin;
            myWidth = haveChildren ? myWidth + marginLeft + marginRight : (80 / 128) + marginLeft + marginRight;
            myHeight += marginTop + marginBottom + (haveChildren ? 0 : 12 / 128);
        } else if (spec.blockType === "command") {
            // let haveChildren = false;
            myWidth = 0;
            // command's height is 24 + 2
            myHeight = (24 + 2) / 128;
            marginTop = margin;
            marginLeft = margin;
            marginBottom = margin;
            marginRight = margin;

            let children = this._cardData.childrenMap.get(card.id);

            children.forEach((phrase) => {
                let c = this.getCard(phrase);
                let {width, height} = this.computeSize(c, nest);
                myWidth += width + margin;
                let max = Math.max(myHeight, height);
                myHeight = Math.max(myHeight, max);
            });
        } else if (spec.blockType === "cShapeHead") {
            let children = this._cardData.childrenMap.get(card.id);
            myHeight = 0;
            myWidth = 0;
            children.forEach((c) => {
                let {width, height} = this.computeSize(this.getCard(c), nest + 1);
                myWidth += width + margin;
                myHeight = Math.max(myHeight, height);
            });
            marginLeft = margin;
            marginTop = margin;
            marginBottom = margin;
            marginRight = margin;
        } else if (spec.blockType === "actionButton") {
            myWidth = 0.4;
            myHeight = 0.4;
            marginLeft = margin;
            marginTop = margin;
            marginBottom = margin;
            marginRight = margin;
        } else if (spec.blockType === "label") {
            let {width, height} = this.measureText(spec.label);
            myWidth = width + margin + margin;
            myHeight = height + margin + margin;
            marginLeft = margin;
            marginTop = margin;
            marginBottom = margin;
            marginRight = margin;
        } else if (spec.blockType === "literal") {
            let str = spec.value !== undefined ? `${spec.value}` : "\u25A1";
            let {width, height} = this.measureText(str);
            myWidth = width + margin + margin;
            myHeight = height + margin + margin;
            marginLeft = margin;
            marginTop = margin;
            marginBottom = margin;
            marginRight = margin;
        } else if (spec.blockType === "expander") {
            let str = spec.state === "expands" ? "\u25B6" : "\u25C0";
            let {width, height} = this.measureText(str);
            myWidth = width + margin + margin;
            myHeight = height + margin + margin;
        } else if (spec.blockType === "dropZone") {
            let width = 50 / 128;
            let height = (24 + 2) / 128; // element.dropType === "command";
            myWidth = width;
            myHeight = height;
            marginLeft = 1;
            marginRight = 1;
            marginTop = 1;
            marginBottom = 1;
        }

        spec.width = myWidth;
        spec.height = myHeight;
        spec.depth = nest;
        spec.marginTop = marginTop;
        spec.marginLeft = marginLeft;
        spec.marginBottom = marginBottom
        spec.marginRight = marginRight;
        return spec;
    }

    measureText(str) {
        let val = this.call("TextTexture$TextTextureActor", "measureText", str);
        return {width: val.width / 128, height: val.height / 128};
    }

    setPosition(card, position) {
        let spec = card._cardData.spec;
        let [x, y, z] = position // the pose coordinate;
        let {width, height} = card._cardData.spec;
        spec.position = position;
        if (spec.blockType === "cShape") {
            console.log(x, y, z);
        }
        if (spec.blockType === "top") {
            let children = this._cardData.childrenMap.get(card.id);
            if (children) {
                children.forEach((c) => {
                    let child = this.getCard(c);
                    let cur = child._cardData.spec.position || [0, 0, 1];
                    this.setPosition(child, [cur[0], cur[1], cur[2]]);
                });
            }
        } else if (spec.blockType === "cShape") {
            let offsetX = x + spec.marginLeft;
            let offsetY = y + spec.marginTop;
            let children = this._cardData.childrenMap.get(card.id);
            if (children) {
                children.forEach((c) => {
                    let child = this.getCard(c);
                    this.setPosition(child, [offsetX, offsetY, z + 1]);
                    offsetY += child._cardData.spec.height + (2 / 128);
                });
            }
        } else if (spec.blockType === "cShapeHead") {
            let offsetX = x;
            let offsetY = y;
            let children = this._cardData.childrenMap.get(card.id);
            if (children) {
                children.forEach((c, i) => {
                    let child = this.getCard(c);
                    let margin = i === 1 ? 0.5 : (i === 2 ? 0.1 : 0);
                    this.setPosition(child, [offsetX + margin, offsetY, z + 1]);
                    offsetX += child._cardData.spec.width + (2 / 128) + margin;
                });
            }
        } else if (spec.blockType === "command") {
            let offsetX = x + spec.marginLeft;
            let offsetY = y + spec.marginTop;
            let children = this._cardData.childrenMap.get(card.id);
            if (children) {
                children.forEach((c) => {
                    let child = this.getCard(c);
                    this.setPosition(child, [offsetX, offsetY, z + 1]);
                    offsetX += child._cardData.spec.width + (2 / 128);
                });
            }
        } else if (spec.blockType === "label" || spec.blockType === "literal" || spec.blockType === "expander") {
        }

        let meters = this.fromPose({width, height, depth: 1}, [x, y, z]);
        card.set({translation: meters});
        card.say("updateElement");
    }

    blockTeared(data) {
        let {viewId, blockId} = data;
        console.log("block teared", viewId, blockId);

        if (this.dropZoneMap.get(viewId)) {
            console.log("somehow it has previous entry");
        }

        let {all, rest} = this.getAllChildren(blockId);

        let parentId = this._cardData.parentMap.get(blockId);
        if (parentId) {
            let siblings = this._cardData.childrenMap.get(parentId);
            let myIndex = siblings.indexOf(blockId);
            if (myIndex >= 0) {
                siblings.splice(myIndex, siblings.length - myIndex);
                this._cardData.parentMap.delete(blockId);
            }
        }

        // this.grab(all);

        let dropZones = this.getDropZonesFor("command");

        this.dropZoneMap.set(viewId, {...data, allMovers: all, rest, dropZones});
    }

    grab(movers) {
        for (let i = 0; i < movers.length; i++) {
            let mover = movers[i];
            let card = this.getCard(mover);
            card.translateBy([0, 0, 0.2]);
        }
    }

    blockMoved(data) {
        let {viewId, blockId, base, offset} = data;
        let {allMovers} = this.dropZoneMap.get(viewId);

        let {v3_add, v3_sub} = Microverse;
        let thisCard = this.getCard(blockId);
        if (!thisCard) {console.log("card not found for some reason");}
        let thisBase = thisCard.translation;
        let tr = v3_add(base, offset);
        thisCard.translateTo(tr);
        let thisOffset = v3_sub(thisCard.translation, thisBase);

        let spec = thisCard._cardData.spec;
        let pose = this.toPose({
            width: spec.width,
            height: spec.height,
            depth: 1
        }, thisCard.translation);
        spec.position = pose;

        for (let i = 1; i < allMovers.length; i++) {
            this.moveBlock(allMovers[i], thisOffset);
        }

        this.testDrop(thisCard, data);
    }

    getAllChildren(blockId, all, rest) {
        let firstTime = !all;
        if (firstTime) {
            all = [];
            rest = [];
        }
        let thisCard = this.getCard(blockId);
        if (!thisCard) {return {all, rest};}
        all.push(blockId);
        let children = this._cardData.childrenMap.get(blockId);
        if (children) {
            children.forEach((c) => {
                this.getAllChildren(c, all, rest);
            });
        }

        if (!firstTime) {return {all, rest};}

        let parentId = this._cardData.parentMap.get(blockId);
        if (!parentId) {return {all, rest};}
        let parent = this.getCard(parentId);
        if (!parent) {return {all, rest};}
        if (parent._cardData.spec.blockType === "top") {return {all, rest};}
        let siblings = this._cardData.childrenMap.get(parentId);

        if (!siblings) {return {all, rest};}

        let myIndex = siblings.indexOf(blockId);
        if (myIndex < 0) {return {all, rest};}
        let younger = siblings.slice(myIndex + 1);
        rest = younger;
        younger.forEach((c) => {
            this.getAllChildren(c, all, rest);
        });
        return {all, rest};
    }

    moveBlock(id, offset) {
        let card = this.getCard(id);
        let t = card.translation;
        card.translateTo(Microverse.v3_add(t, offset));
    }

    testDrop(block, data) {
        // block is the top one that is being moved
        let {viewId} = data;
        let {v3_add, v2_distance} = Microverse;

        let moveInfo = this.dropZoneMap.get(viewId);

        let spec = block._cardData.spec;
        let t = this.toPose({
            width: spec.width,
            height: spec.height,
            depth: 1
        }, block.translation);

        let corners = {
            topLeft: t, topRight: v3_add(t, [spec.width, 0, 0]),
            bottomLeft: v3_add(t, [0, spec.height, 0]), bottomRight: v3_add(t, [spec.width, spec.height, 0])
        };

        let min = Number.MAX_VALUE;
        let minInfo = null;

        moveInfo.dropZones.forEach((info) => {
            let distance = Math.min(
                v2_distance(corners.topLeft, info.left),
                v2_distance(corners.bottomLeft, info.right)
            );

            if (distance < min) {
                min = distance;
                minInfo = info;
            }
        });

        if (min > 1) {
            minInfo = null;
        }

        if (!minInfo && moveInfo?.dropZone?.zoneId) {
            this.removeBlockHelper(moveInfo.dropZone.zoneId);
            delete moveInfo.dropZone;
            this.blockLayout();
            return;
        }

        if (!moveInfo.dropZone && minInfo) {
            let zoneId = this.addDropZone(minInfo);
            moveInfo.dropZone = {minInfo, zoneId};
            this.blockLayout();
            return;
        }

        if (!moveInfo?.dropZone) {return;}

        if (!this.equalTarget(moveInfo.dropZone.minInfo, minInfo)) {
            this.removeBlockHelper(moveInfo.dropZone.zoneId);
            let zoneId = this.addDropZone(minInfo);
            moveInfo.dropZone = {minInfo, zoneId};
            this.blockLayout();
        }
    }

    equalTarget(a, b) {
        return a.owner === b.owner && a.info === b.info;
    }

    blockReleased(data) {
        let {viewId} = data;
        let moveInfo = this.dropZoneMap.get(viewId);

        if (!moveInfo?.blockId) {return;}
        let card = this.getCard(moveInfo.blockId);
        if (moveInfo?.dropZone?.minInfo) {
            // if over a dropzone
            let index = moveInfo.dropZone.minInfo.info;
            let ownerId = moveInfo.dropZone.minInfo.owner;
            let zoneId = moveInfo.dropZone.zoneId;
            this.removeBlockHelper(zoneId);
            this.insertBlock(ownerId, card, index);
            if (moveInfo.rest) {
                for (let i = 0; i < moveInfo.rest.length; i++) {
                    let rest = moveInfo.rest[i];
                    let card = this.getCard(rest);
                    this.insertBlock(ownerId, card, index + i + 1);
                }
            }
            this.blockLayout();
            this.dropZoneMap.delete(viewId);
        } else {
            this.insertBlock(this._cardData.topId, card);
        }
    }

    getDropZonesFor(type, node) {
        let firstTime = !node;
        let {v3_add} = Microverse;

        if (firstTime) {
            node = this.getCard(this._cardData.topId);
        }

        let spec = node._cardData.spec;

        let blockType = spec.blockType;

        let blockId = node.id;
        let children = this._cardData.childrenMap.get(blockId);

        let dropZones = [];
        if (blockType === "top") {
            children.forEach((c) => {
                let child = this.getCard(c);
                let ds = this.getDropZonesFor(type, child);
                dropZones.push(...ds);
            });
            return dropZones;
        }

        if (blockType === "cShape") {
            let pose = this.toPose({width: spec.width, height: spec.height, depth: 0}, node.translation);

            console.log("children", children);
            // the first one should be always the label
            let label = this.getCard(children[0]);

            let head = spec.marginTop + label._cardData.spec.height;
            let left = spec.marginLeft;

            let zone = {
                left: v3_add(pose, [left, head, 0]),
                right: v3_add(pose, [left + 1, head, 0]),
                owner: node.id,
                info: 1
            };

            dropZones.push(zone);

            children.slice(1).forEach((c, ind) => {
                let child = this.getCard(c);
                let cSpec = child._cardData.spec;
                let cPose = this.toPose({width: cSpec.width, height: cSpec.height, depth: 0}, child.translation);
                let zone = {
                    left: v3_add(cPose, [0, cSpec.height, 0]), right: v3_add(cPose, [0 + 1, cSpec.height, 0]),
                    owner: node.id,
                    info: ind + 2
                };
                dropZones.push(zone);
            });

            children.forEach((c) => {
                let child = this.getCard(c);
                let ds = this.getDropZonesFor(type, child);
                dropZones.push(...ds);
            });
            return dropZones;
        }

        return dropZones;
    }

    action(data) {
        let {target, action} = data;

        if (this.runner) {
            this.runner.destroy();
        }

        if (action === "go") {
            let tree = this.makeTree(target);
            this.runner = this.createCard({
                type: "object",
                parent: this._cardData.target,
                behaviorModules: ["ScriptRunner"]
            });

            this.runner.call("ScriptRunner$ScriptRunnerActor", "start", tree);
            console.log(target, action);
        }
    }

    makeTree(target) {
        let card = this.getCard(target);
        let spec = card._cardData.spec;

        if (spec.blockType === "cShape") {
            let childrenIds = this._cardData.childrenMap.get(target);
            let children = childrenIds.slice(1).map((cid) => this.makeTree(cid));
            let map = {together: "par", "in order": "seq"};
            return {type: map[spec.name], children};
        }

        if (spec.blockType === "command") {
            let action = ["ScriptActions$ScriptActionsActor", spec.name];
            let params = [];
            let duration;
            let nextOver = false;
            for (let i = 0; i < spec.sentence.length; i++) {
                let s = spec.sentence[i];
                if (s.blockType === "literal") {
                    if (nextOver) {
                        nextOver = false;
                        duration = s.value * 1000;
                    } else {
                        params.push(s.value);
                    }
                }
                if (s.blockType === "label" && s.label === "over") {
                    nextOver = true;
                }
            }
            return {
                type: "call",
                object: this._cardData.target,
                action,
                params: params[0],
                duration
            }
        }
    }
}

class BlockPanelPawn extends PawnBehavior {
    setup() {
        [...this.shape.children].forEach(c => c.removeFromParent());
        this.blocksMap = new Map();

        if (this.actor._cardData.layoutReady) {
            // this.updateBlocks();
        }
    }

    teardown() {
        if (this.texture) {
            this.texture.dispose();
            this.texture = null;
            this.canvas = null;
            this.ctx = null;
        }
    }
}

class SpawnerActor extends ActorBehavior {
    setup() {
        this.addEventListener("pointerTap", "spawn");
    }

    spawn() {
        this.createCard({
            translation: Microverse.v3_add(this.translation, [0.05, 0.05, 0]),
            type: "object",
            // behaviorModules: ["Block", "Drag"],
            parent: this.parent,
            noSave: true
        });
        console.log("spawn");
    }

}

class BlockActor extends ActorBehavior {
    setup() {
    }
}

class BlockPawn extends PawnBehavior {
    setup() {
        [...this.shape.children].forEach((c) => this.shape.remove(c));

        this.panel = this.actor.service("ActorManager").actors.get(this.actor._cardData.panel);

        this.canvasSize = this.panel._cardData.canvasSize;
        this.panelPawn = Microverse.GetPawn(this.panel.id);

        if (this.panel._cardData.layoutReady && this.panelPawn?.renderingDone) {
            this.createBlock();
        }

        this.subscribe(this.panel.id, "doneRendering", "createBlock");
        this.subscribe(this.panel.id, "blockLayout", "createBlock");
    }

    createBlock() {
        let spec = this.actor._cardData.spec;
        let THREE = Microverse.THREE;
        let {width, height} = spec;

        if (this.spec && this.spec.width === width && this.spec.height === height && this.mesh) {
            return;
        }

        this.spec = {width, height};

        if (this.mesh) {
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.mesh.removeFromParent();
            delete this.mesh;
        }

        if (spec.blockType === "top") {
            let geometry = new THREE.BoxGeometry(width, height, 0.1);
            let material = new THREE.MeshStandardMaterial({color: 0xddeedd, metalness: 0.6});
            this.mesh = new THREE.Mesh(geometry, material);
            this.shape.add(this.mesh);
            return this.mesh;
        }
        if (spec.blockType === "cShape") {
            let shape = new THREE.Shape();
            let curve = 0.04;
            shape.moveTo(-width / 2 + curve, height / 2);
            shape.lineTo(width / 2 - curve, height / 2);
            shape.quadraticCurveTo(width / 2, height / 2, width / 2, height / 2 - curve);
            shape.lineTo(width / 2, -height / 2 + curve);
            shape.quadraticCurveTo(width / 2, -height / 2, width / 2 - curve, - height / 2);
            shape.lineTo(-width / 2 + curve, -height / 2);
            shape.quadraticCurveTo(-width / 2, -height / 2, -width / 2, -height / 2 + curve);
            shape.lineTo(-width / 2, height / 2 - curve);
            shape.quadraticCurveTo(-width / 2, height / 2, -width / 2 + curve, height / 2);

            let extrudeSettings = {
                bevelEnabled: true,
                bevelThickness: 0,
                bevelSize: 0,
                bevelOffset: 0,
                bevelSegments: 0,
                depth: 0.02,
                steps: 5,
            }

            let geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            let material = new THREE.MeshStandardMaterial({color: this.actor._cardData.color || 0xeeffee});
            this.mesh = new THREE.Mesh(geometry, material);
            this.shape.add(this.mesh);
            return this.mesh;
        } else if (spec.blockType === "command") {
            let shape = new THREE.Shape();
            let curve = 0.04;
            shape.moveTo(-width / 2 + curve, height / 2);
            shape.lineTo(width / 2 - curve, height / 2);
            shape.quadraticCurveTo(width / 2, height / 2, width / 2, height / 2 - curve);
            shape.lineTo(width / 2, -height / 2 + curve);
            shape.quadraticCurveTo(width / 2, -height / 2, width / 2 - curve, - height / 2);
            shape.lineTo(-width / 2 + curve, -height / 2);
            shape.quadraticCurveTo(-width / 2, -height / 2, -width / 2, -height / 2 + curve);
            shape.lineTo(-width / 2, height / 2 - curve);
            shape.quadraticCurveTo(-width / 2, height / 2, -width / 2 + curve, height / 2);

            let extrudeSettings = {
                bevelEnabled: true,
                bevelThickness: 0,
                bevelSize: 0,
                bevelOffset: 0,
                bevelSegments: 0,
                depth: 0.02,
                steps: 5,
            }

            let geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            let material = new THREE.MeshStandardMaterial({color: this.actor._cardData.color || 0xffeeff});
            this.mesh = new THREE.Mesh(geometry, material);
            this.shape.add(this.mesh);
            return this.mesh;
        } else if (spec.blockType === "label" || spec.blockType === "expander" || spec.blockType === "literal") {
            this.mesh = this.createPhrase(this.actor._cardData.spec);
            this.shape.add(this.mesh);
            return this.smesh;
        } else if (spec.blockType === "dropZone") {
            let geometry = new THREE.BoxGeometry(width, height, 0.1);
            let material = new THREE.MeshStandardMaterial({color: 0xffffff, metalness: 0.6});
            this.mesh = new THREE.Mesh(geometry, material);
            this.shape.add(this.mesh);
            return this.mesh;
        }
    }

    /*

    getCard(id) {
        return this.actor.service("ActorManager").actors.get(id);
        }
    */

    createPhrase(spec) {
        let THREE = Microverse.THREE;
        let {width, height, blockType, value, label} = spec;

        if (blockType === "label" ||
            blockType === "literal" || blockType === "expander") {
            let shape = new THREE.Shape();
            let curve = 0.06;
            shape.moveTo(-width / 2 + curve, height / 2);
            shape.lineTo(width / 2 - curve, height / 2);
            shape.quadraticCurveTo(width / 2, height / 2, width / 2, height / 2 - curve);
            shape.lineTo(width / 2, -height / 2 + curve);
            shape.quadraticCurveTo(width / 2, -height / 2, width / 2 - curve, - height / 2);
            shape.lineTo(-width / 2 + curve, -height / 2);
            shape.quadraticCurveTo(-width / 2, -height / 2, -width / 2, -height / 2 + curve);
            shape.lineTo(-width / 2, height / 2 - curve);
            shape.quadraticCurveTo(-width / 2, height / 2, -width / 2 + curve, height / 2);

            let extrudeSettings = {
                bevelEnabled: true,
                bevelThickness: 0,
                bevelSize: 0,
                bevelOffset: 0,
                bevelSegments: 0,
                depth: 0.02,
                steps: 5,
            }

            let geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);

            let uv = geometry.getAttribute("uv");

            let info = this.panel._cardData.strings.get(blockType === "literal" ? `${value}` : label);

            // scale is always the relationship between line height in canvas and the display.
            //

            // canvas width would be mapped to the full width of this element.
            // so scaleW would the ratio. it is uniform so as long as the height is shorter than width,
            // we use the same scaleW for h.
            // now that the info.x has to come to the left edge of element
            // which is half of the scaleW itself plus info.x' relative position within canvas.width

            // info.y has to come to the top edge of element.
            // (info.y + info.height / 2) should go center

            let scaleW = info ? (info.width / this.canvasSize) : 0;
            let offX = info ? ((info.x - 1) / this.canvasSize) : 0;
            let offY = info ? (this.canvasSize / 2 - (info.y + 2 + info.height / 2)) / this.canvasSize : 0;

            let scale = 128 / this.canvasSize;

            for (let i = 0; i < uv.array.length; i += 2) {
                uv.array[i] = uv.array[i] * scale + (scaleW / 2) + offX;
                uv.array[i+1] = uv.array[i+1] * scale + 0.5 + offY; // eslint-disable-line
            }

            geometry.setAttribute("uv",  new THREE.BufferAttribute(new Float32Array(uv.array), 2));

            let material = new THREE.MeshStandardMaterial({map: this.panelPawn?.texture, color: this.actor._cardData.color || 0xffeeff});
            return new THREE.Mesh(geometry, material);
        }
    }
}

class BlockDragActor extends ActorBehavior {
}

class BlockDragPawn extends PawnBehavior {
    setup() {
        let movable = ["cShape", "command"].includes(this.actor._cardData.spec.blockType);
        if (movable) {
            this.addEventListener("pointerMove", "pointerMove");
            this.addEventListener("pointerDown", "pointerDown");
            this.addEventListener("pointerUp", "pointerUp");
        }
        // if (this.actor._cardData.spec.blockType === "dropZone") {
        // this.addEventListener("pointerMove", "pointerIgnore");
        // }
    }

    pointerDown(evt) {
        if (!evt.xyz) {return;}
        let {THREE, v3_rotate} = Microverse;

        // let normal = [q_pitch(this.rotation), q_yaw(this.rotation), q_roll(this.rotation)];

        let normal = v3_rotate([0, 0, 1], this.panel.rotation);

        this._dragPlane = new THREE.Plane();
        this._dragPlane.setFromNormalAndCoplanarPoint(
            new THREE.Vector3(...normal),
            new THREE.Vector3(...evt.xyz)
        );

        this.downInfo = {translation: this.translation, downPosition: evt.xyz, firstTime: true};
        let avatar = this.getMyAvatar();
        if (avatar) {
            avatar.addFirstResponder("pointerMove", {}, this);
        }
    }

    pointerMove(evt) {
        if (!this.downInfo) {return;}
        if (!evt.ray) {return;}

        let {THREE, v3_sub} = Microverse;
        let origin = new THREE.Vector3(...evt.ray.origin);
        let direction = new THREE.Vector3(...evt.ray.direction);
        let ray = new THREE.Ray(origin, direction);

        let dragPoint = ray.intersectPlane(
            this._dragPlane,
            new Microverse.THREE.Vector3()
        );

        let down = this.downInfo.downPosition;
        let drag = dragPoint.toArray();

        let diff = v3_sub(drag, down);

        if (this.downInfo.firstTime) {
            this.downInfo.firstTime = false;
            this.publish(this.panel.id, "blockTeared", {viewId: this.viewId, blockId: this.actor.id});
        }

        this.publish(this.panel.id, "blockMoved", {
            viewId: this.viewId,
            blockId: this.actor.id,
            base: this.downInfo.translation,
            offset: diff
        });
    }

    pointerIgnore(_evt) {
    }

    pointerUp(evt) {
        console.log("pointerUp", evt);
        this._dragPlane = null;
        let avatar = this.getMyAvatar();
        if (avatar) {
            avatar.removeFirstResponder("pointerMove", {}, this);
        }
        this.publish(this.panel.id, "blockReleased", {viewId: this.viewId, blockId: this.actor.id});
    }
}

class ActionButtonPawn extends PawnBehavior {
    setup() {
        [...this.shape.children].forEach((c) => {
            c.removeFromParent();
        });
        let cube = this.makeCube();
        this.shape.add(cube);

        this.addEventListener("pointerDown", "action");
    }

    action() {
        this.publish(this.panel.id, "action", {target: this.actor._cardData.actionTarget, action: this.actor._cardData.actionName});
    }

    makeCube() {
        let geometry = new Microverse.THREE.BoxGeometry(0.4, 0.4, 0.1);
        let color = this.actor._cardData.actionName === "go" ? 0x00ff00 : 0xff0000;
        let material = new Microverse.THREE.MeshStandardMaterial({color, metalness: 0.8});
        return new Microverse.THREE.Mesh(geometry, material);
    }
}

export default {
    modules: [
        {
            name: "BlockPanel",
            actorBehaviors: [BlockPanelActor],
            pawnBehaviors: [BlockPanelPawn]
        },
        {
            name: "Block",
            actorBehaviors: [BlockActor],
            pawnBehaviors: [BlockPawn]
        },
        {
            name: "Spawner",
            actorBehaviors: [SpawnerActor],
            // pawnBehaviors: [BlockPawn]
        },
        {
            name: "BlockSpecManager",
            actorBehaviors: [BlockSpecManagerActor]
        },
        {
            name: "BlockDrag",
            actorBehaviors: [BlockDragActor],
            pawnBehaviors: [BlockDragPawn]
        },
        {
            name: "ActionButton",
            pawnBehaviors: [ActionButtonPawn]
        }
    ]
}

/* globals Microverse */
