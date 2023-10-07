import {PawnBehavior} from "../PrototypeBehavior.d.ts";

class DragPawn extends PawnBehavior {
    setup() {
        this.addEventListener("pointerMove", "pointerMove");
        this.addEventListener("pointerDown", "pointerDown");
        this.addEventListener("pointerUp", "pointerUp");
    }

    pointerMove(evt) {
        if (!this.downInfo) {return;}
        if (!evt.ray) {return;}

        let {THREE, v3_add, v3_sub} = Microverse;
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
        let newPos = v3_add(this.downInfo.translation, diff);

        // let [x,y,z] = newPos;

        this.set({translation: newPos});
    }

    pointerDown(evt) {
        if (!evt.xyz) {return;}
        let {THREE, v3_rotate} = Microverse;

        console.log("debugger");
        let rot = this.parent.rotation;
        let normal = v3_rotate([0, 0, 1], rot);

        this._dragPlane = new THREE.Plane();
        this._dragPlane.setFromNormalAndCoplanarPoint(
            new THREE.Vector3(...normal),
            new THREE.Vector3(...evt.xyz)
        );

        this.downInfo = {translation: this.translation, downPosition: evt.xyz};
        let avatar = this.getMyAvatar();
        if (avatar) {
            avatar.addFirstResponder("pointerMove", {}, this);
        }
    }

    pointerUp(_evt) {
        this._dragPlane = null;
        let avatar = this.getMyAvatar();
        if (avatar) {
            avatar.removeFirstResponder("pointerMove", {}, this);
        }
    }
}

export default {
    modules: [
        {
            name: "Drag",
            pawnBehaviors: [DragPawn]
        }
    ]
}

/* globals Microverse */
