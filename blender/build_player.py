"""
Builds the chibi football player: low-poly mesh, armature, animation clips.
Exports public/models/player.glb and saves blender/player.blend.

Run:  /Applications/Blender.app/Contents/MacOS/Blender -b --python blender/build_player.py
      add `-- --preview` to also render PNG previews into blender/preview/

Conventions (Blender, Z up): character faces -Y, its left side is +X.
Material names (Jersey, Pants, Helmet, Stripe, ...) are what the web app recolors per team.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
GLB_PATH = ROOT / "public" / "models" / "player.glb"
BLEND_PATH = HERE / "player.blend"
PREVIEW = "--preview" in sys.argv
FPS = 30

# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS

# ---------------------------------------------------------------- materials
PALETTE = {
    "Jersey": (0.31, 0.15, 0.51),
    "Pants": (0.95, 0.75, 0.2),
    "Helmet": (0.31, 0.15, 0.51),
    "Stripe": (0.95, 0.75, 0.2),
    "Mask": (0.85, 0.85, 0.88),
    "Skin": (0.87, 0.64, 0.48),
    "Blush": (0.98, 0.55, 0.55),
    "Eye": (0.05, 0.05, 0.08),
    "Glove": (0.95, 0.95, 0.95),
    "Socks": (0.95, 0.95, 0.95),
    "Shoe": (0.08, 0.08, 0.1),
}
MATS = {}
for name, rgb in PALETTE.items():
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1.0)
    if m.node_tree is None:
        try:
            m.use_nodes = True
        except Exception:
            pass
    bsdf = m.node_tree.nodes.get("Principled BSDF") if m.node_tree else None
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.75
    MATS[name] = m

# ---------------------------------------------------------------- mesh parts
PARTS = []


def finish(obj, mat, bone, scale=None):
    if scale:
        obj.scale = scale
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.materials.append(MATS[mat])
    for p in obj.data.polygons:
        p.use_smooth = False
    vg = obj.vertex_groups.new(name=bone)
    vg.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    PARTS.append(obj)
    return obj


def cube(loc, size, mat, bone):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    return finish(bpy.context.active_object, mat, bone, scale=size)


def cyl(loc, r, depth, mat, bone, verts=8, rot=(0, 0, 0), scale=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    return finish(bpy.context.active_object, mat, bone, scale=scale)


def cone(loc, r1, r2, depth, mat, bone, verts=8, scale=None):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc)
    return finish(bpy.context.active_object, mat, bone, scale=scale)


def sphere(loc, r, mat, bone, seg=10, rings=7, scale=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc)
    return finish(bpy.context.active_object, mat, bone, scale=scale)


def torus(loc, major, minor, mat, bone, scale=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=16,
                                     minor_segments=4, location=loc)
    return finish(bpy.context.active_object, mat, bone, scale=scale)


for side, sx in (("L", 1), ("R", -1)):
    x = 0.11 * sx
    # legs
    cube((x, -0.035, 0.04), (0.12, 0.21, 0.08), "Shoe", f"foot.{side}")
    cyl((x, 0, 0.19), 0.055, 0.26, "Socks", f"shin.{side}")
    cyl((x, 0, 0.45), 0.075, 0.26, "Pants", f"thigh.{side}")
    # arms
    ax = 0.26 * sx
    cyl((ax, 0, 0.85), 0.056, 0.22, "Jersey", f"upper_arm.{side}")
    cyl((ax, 0, 0.65), 0.046, 0.2, "Skin", f"forearm.{side}")
    sphere((ax, 0, 0.53), 0.066, "Glove", f"forearm.{side}", seg=8, rings=6)
    # face details
    sphere((0.075 * sx, -0.29, 1.21), 0.034, "Eye", "head", seg=8, rings=6, scale=(1, 0.5, 1.15))
    sphere((0.125 * sx, -0.255, 1.13), 0.03, "Blush", "head", seg=8, rings=5, scale=(1.3, 0.4, 0.8))

# hips + torso
cube((0, 0, 0.6), (0.34, 0.22, 0.16), "Pants", "hips")
cone((0, 0, 0.8), 0.17, 0.21, 0.36, "Jersey", "spine", scale=(1, 0.72, 1))
sphere((0, 0, 0.97), 0.27, "Jersey", "spine", seg=10, rings=6, scale=(1, 0.66, 0.32))
# head: big helmet, face peeking out, facemask, stripe
sphere((0, 0, 1.22), 0.275, "Helmet", "head", seg=12, rings=8, scale=(1, 1.04, 1))
sphere((0, 0.035, 1.235), 0.282, "Stripe", "head", seg=12, rings=8, scale=(0.2, 1.04, 1))
sphere((0, -0.12, 1.17), 0.19, "Skin", "head", seg=12, rings=8)
torus((0, -0.13, 1.04), 0.2, 0.014, "Mask", "head")
torus((0, -0.13, 1.1), 0.205, 0.012, "Mask", "head")

bpy.ops.object.select_all(action="DESELECT")
for o in PARTS:
    o.select_set(True)
bpy.context.view_layer.objects.active = PARTS[0]
bpy.ops.object.join()
body = bpy.context.active_object
body.name = "Player"
body.data.name = "PlayerMesh"

# ---------------------------------------------------------------- armature
arm_data = bpy.data.armatures.new("Rig")
rig = bpy.data.objects.new("Rig", arm_data)
scene.collection.objects.link(rig)
bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active = rig
rig.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")

BONES = [
    # name, head, tail, parent
    ("root", (0, 0, 0), (0, 0, 0.25), None),
    ("hips", (0, 0, 0.58), (0, 0, 0.68), "root"),
    ("spine", (0, 0, 0.66), (0, 0, 1.0), "hips"),
    ("head", (0, 0, 1.0), (0, 0, 1.45), "spine"),
]
for side, sx in (("L", 1), ("R", -1)):
    BONES += [
        (f"upper_arm.{side}", (0.26 * sx, 0, 0.95), (0.26 * sx, 0, 0.75), "spine"),
        (f"forearm.{side}", (0.26 * sx, 0, 0.75), (0.26 * sx, 0, 0.55), f"upper_arm.{side}"),
        (f"thigh.{side}", (0.11 * sx, 0, 0.58), (0.11 * sx, 0, 0.32), "hips"),
        (f"shin.{side}", (0.11 * sx, 0, 0.32), (0.11 * sx, 0, 0.07), f"thigh.{side}"),
        (f"foot.{side}", (0.11 * sx, 0, 0.07), (0.11 * sx, 0, 0.0), f"shin.{side}"),
    ]
for name, h, t, parent in BONES:
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail, eb.roll = Vector(h), Vector(t), 0.0
    if parent:
        eb.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")

body.parent = rig
mod = body.modifiers.new("Armature", "ARMATURE")
mod.object = rig

# ---------------------------------------------------------------- axis calibration
# Bone-local axes depend on bone direction/roll, so measure them instead of guessing.
# swing+  : tail moves forward (-Y)          (legs/arms forward, spine leans forward)
# spread+ : tail moves away from centerline   (centre bones: toward character's left, +X)
# twist+  : chest turns toward character's left (+X)
PB = rig.pose.bones
for pb in PB:
    pb.rotation_mode = "XYZ"


def posed(pb, p):
    return (pb.matrix @ pb.bone.matrix_local.inverted()) @ p


CAL = {}
for pb in PB:
    tail = pb.bone.tail_local.copy()
    fwd = pb.bone.head_local + Vector((0, -0.3, 0))
    side = 1 if pb.bone.head_local.x >= 0 else -1
    deltas = []
    for i in range(3):
        e = [0, 0, 0]
        e[i] = 0.3
        pb.rotation_euler = e
        bpy.context.view_layer.update()
        deltas.append((posed(pb, tail) - tail, posed(pb, fwd) - fwd))
        pb.rotation_euler = (0, 0, 0)
    swing = max(range(3), key=lambda i: abs(deltas[i][0].y))
    spread = max((i for i in range(3) if i != swing), key=lambda i: abs(deltas[i][0].x))
    twist = 3 - swing - spread
    CAL[pb.name] = {
        "swing": (swing, -1 if deltas[swing][0].y > 0 else 1),
        "spread": (spread, 1 if deltas[spread][0].x * side > 0 else -1),
        "twist": (twist, 1 if deltas[twist][1].x > 0 else -1),
    }

# root location axes
root = PB["root"]
loc_d = []
for i in range(3):
    v = [0, 0, 0]
    v[i] = 1.0
    root.location = v
    bpy.context.view_layer.update()
    loc_d.append(posed(root, Vector((0, 0, 0))))
    root.location = (0, 0, 0)
UP_AX = max(range(3), key=lambda i: abs(loc_d[i].z))
UP_SIGN = 1 if loc_d[UP_AX].z > 0 else -1
FWD_AX = max((i for i in range(3) if i != UP_AX), key=lambda i: abs(loc_d[i].y))
FWD_SIGN = 1 if loc_d[FWD_AX].y < 0 else -1
bpy.context.view_layer.update()

# ---------------------------------------------------------------- posing helpers
R = math.radians


def _apply(spec, root_spec):
    for pb in PB:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
    for name, vals in spec.items():
        vals = tuple(vals) + (0,) * (3 - len(vals))
        e = [0.0, 0.0, 0.0]
        for key, deg in zip(("swing", "spread", "twist"), vals):
            ax, sgn = CAL[name][key]
            e[ax] += R(deg) * sgn
        PB[name].rotation_euler = e
    r = root_spec or {}
    loc = [0.0, 0.0, 0.0]
    loc[UP_AX] = r.get("up", 0) * UP_SIGN
    loc[FWD_AX] = r.get("fwd", 0) * FWD_SIGN
    root.location = loc
    if "pitch" in r:
        ax, sgn = CAL["root"]["swing"]
        e = [0.0, 0.0, 0.0]
        e[ax] = R(r["pitch"]) * sgn
        root.rotation_euler = e


def _min_z():
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    m = ev.to_mesh()
    z = min(v.co.z for v in m.vertices)
    ev.to_mesh_clear()
    return z


def set_pose(spec, root_spec=None, ground=True, lift=0.0):
    """Pose the rig. Feet auto-flatten unless given. With ground=True the root is
    raised/lowered so the lowest vertex sits on the turf, then `lift` is added."""
    spec = dict(spec)
    r = dict(root_spec or {})
    pitch = r.get("pitch", 0)
    hips = (spec.get("hips") or (0,))[0]
    for side in ("L", "R"):
        if f"foot.{side}" not in spec:
            leg = (spec.get(f"thigh.{side}") or (0,))[0] + (spec.get(f"shin.{side}") or (0,))[0]
            # world angle of the shin (forward-from-down); counter it so the sole stays flat
            flat = -(leg - hips - pitch) if pitch < 45 else 25
            spec[f"foot.{side}"] = (max(-40, min(50, flat)),)
    if ground:
        r["up"] = 0.0
        _apply(spec, r)
        r["up"] = -_min_z() + lift
    _apply(spec, r)


def key_all(frame):
    for pb in PB:
        pb.keyframe_insert("rotation_euler", frame=frame, group=pb.name)
        pb.keyframe_insert("location", frame=frame, group=pb.name)


def mirror(spec):
    """Swap .L/.R entries (twist flips sign)."""
    out = {}
    for k, v in spec.items():
        v = tuple(v) + (0,) * (3 - len(v))
        if k.endswith(".L"):
            out[k[:-2] + ".R"] = v
        elif k.endswith(".R"):
            out[k[:-2] + ".L"] = v
        else:
            out[k] = (v[0], -v[1], -v[2])
    return out


rig.animation_data_create()
prefs = bpy.context.preferences.edit
CLIPS = []


def begin(name, interp):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data.action = act
    prefs.keyframe_new_interpolation_type = interp
    CLIPS.append(name)
    return act


def sampled(name, frames, fn, step=1):
    begin(name, "LINEAR")
    for f in range(0, frames + 1, step):
        spec, r, *opts = fn(f / frames)
        set_pose(spec, r, **(opts[0] if opts else {}))
        key_all(f)


def keyed(name, keys):
    begin(name, "BEZIER")
    for f, spec, r, *opts in keys:
        set_pose(spec, r, **(opts[0] if opts else {}))
        key_all(f)


TAU = math.tau
s, c = math.sin, math.cos

# ---------------------------------------------------------------- clips
NEUTRAL_ARMS = {"upper_arm.L": (5, 10), "upper_arm.R": (5, 10), "forearm.L": (15,), "forearm.R": (15,)}


def idle(t):
    p = t * TAU
    return ({
        "spine": (3 + 1.5 * s(p), 0, 0),
        "head": (-2 * s(p), 3 * s(p)),
        "upper_arm.L": (4 + 2 * s(p), 10 + 2 * s(p)),
        "upper_arm.R": (4 + 2 * s(p), 10 + 2 * s(p)),
        "forearm.L": (15,), "forearm.R": (15,),
    }, None)


sampled("Idle", 60, idle, step=3)


def stance(t):
    p = t * TAU
    b = 1.5 * s(p)
    return ({
        "hips": (25,), "spine": (20 + b,), "head": (-35 - b,),
        "thigh.L": (75, 10), "thigh.R": (75, 10), "shin.L": (-85,), "shin.R": (-85,),
        "upper_arm.L": (30, 18), "upper_arm.R": (30, 18),
        "forearm.L": (45 + b,), "forearm.R": (45 + b,),
    }, None)


sampled("Stance", 60, stance, step=3)


def run(t):
    p = t * TAU
    return ({
        "spine": (14, 0, 9 * s(p)), "head": (-12, 0, -6 * s(p)),
        "thigh.L": (10 + 42 * s(p),), "thigh.R": (10 - 42 * s(p),),
        "shin.L": (-20 - 50 * (0.5 + 0.5 * c(p)),), "shin.R": (-20 - 50 * (0.5 - 0.5 * c(p)),),
        "upper_arm.L": (5 - 50 * s(p), 14), "upper_arm.R": (5 + 50 * s(p), 14),
        "forearm.L": (85 + 10 * s(p),), "forearm.R": (85 - 10 * s(p),),
    }, None, {"lift": 0.035 * abs(c(p))})


sampled("Run", 20, run)


def block(t):
    p = t * TAU
    return ({
        "hips": (20,), "spine": (22,), "head": (-32,),
        "thigh.L": (60 + 10 * s(p), 12), "thigh.R": (60 - 10 * s(p), 12),
        "shin.L": (-75 - 10 * s(p),), "shin.R": (-75 + 10 * s(p),),
        "upper_arm.L": (85 + 10 * s(p * 2), 10), "upper_arm.R": (85 - 10 * s(p * 2), 10),
        "forearm.L": (40 - 15 * s(p * 2),), "forearm.R": (40 + 15 * s(p * 2),),
    }, None)


sampled("Block", 40, block, step=2)


def celebrate(t):
    p = t * TAU
    h = s(t * math.pi)  # 0 -> 1 -> 0 hop
    return ({
        "spine": (-8 * h,), "head": (-15 * h,),
        "thigh.L": (25 * (1 - h) + 10 * h,), "thigh.R": (25 * (1 - h) - 5 * h,),
        "shin.L": (-45 * (1 - h) - 25 * h,), "shin.R": (-45 * (1 - h) - 10 * h,),
        "upper_arm.L": (150, 25 + 10 * s(p * 2)), "upper_arm.R": (150, 25 - 10 * s(p * 2)),
        "forearm.L": (25 + 25 * s(p * 2),), "forearm.R": (25 - 25 * s(p * 2),),
    }, None, {"lift": 0.28 * h})


sampled("Celebrate", 24, celebrate, step=2)

READY_QB = {
    "spine": (6,), "head": (-4,),
    "upper_arm.R": (55, 18), "forearm.R": (75,),
    "upper_arm.L": (45, -5), "forearm.L": (85,),
    "thigh.L": (8,), "thigh.R": (-4,), "shin.L": (-10,), "shin.R": (-10,),
}
keyed("Throw", [
    (0, READY_QB, {"up": -0.01}),
    (10, {
        "spine": (-6, 0, -35), "head": (-6, 0, 30),
        "upper_arm.R": (-15, 85), "forearm.R": (100,),
        "upper_arm.L": (80, 5), "forearm.L": (15,),
        "thigh.L": (28,), "shin.L": (-12,), "thigh.R": (-12,), "shin.R": (-8,),
    }, {"up": -0.02}),
    (16, {
        "spine": (14, 0, 22), "head": (0, 0, -15),
        "upper_arm.R": (165, 30), "forearm.R": (15,),
        "upper_arm.L": (25, 25), "forearm.L": (70,),
        "thigh.L": (25,), "shin.L": (-15,), "thigh.R": (-18,), "shin.R": (-25,),
    }, {"up": -0.03}),
    (24, {
        "spine": (26, 0, 32), "head": (-10, 0, -20),
        "upper_arm.R": (55, -20), "forearm.R": (35,),
        "upper_arm.L": (15, 25), "forearm.L": (60,),
        "thigh.L": (22,), "shin.L": (-20,), "thigh.R": (5,), "shin.R": (-40,),
    }, {"up": -0.04}),
    (36, {**idle(0)[0]}, None),
])

keyed("Catch", [
    (0, run(0.25)[0], {"up": 0.0}),
    (6, {
        "spine": (-6,), "head": (-25,),
        "upper_arm.L": (145, 8), "upper_arm.R": (145, 8),
        "forearm.L": (15,), "forearm.R": (15,),
        "thigh.L": (20,), "shin.L": (-40,), "thigh.R": (-10,), "shin.R": (-30,),
    }, {"up": 0.05}),
    (11, {
        "spine": (-4,), "head": (-20,),
        "upper_arm.L": (135, 6), "upper_arm.R": (135, 6),
        "forearm.L": (30,), "forearm.R": (30,),
        "thigh.L": (15,), "shin.L": (-35,), "thigh.R": (-5,), "shin.R": (-30,),
    }, {"up": 0.03}),
    (18, {
        "spine": (10,), "head": (-8,),
        "upper_arm.R": (25, 4), "forearm.R": (115,),
        "upper_arm.L": (45, -12), "forearm.L": (100,),
        "thigh.L": (10,), "shin.L": (-25,), "thigh.R": (0,), "shin.R": (-25,),
    }, {"up": 0.0}),
    (24, {
        "spine": (12,), "head": (-10,),
        "upper_arm.R": (25, 4), "forearm.R": (115,),
        "upper_arm.L": (45, -12), "forearm.L": (100,),
    }, None),
])

keyed("Dive", [
    (0, run(0.0)[0], None),
    (6, {
        "hips": (10,), "spine": (32,), "head": (-30,),
        "thigh.L": (50,), "thigh.R": (50,), "shin.L": (-75,), "shin.R": (-75,),
        "upper_arm.L": (60, 15), "upper_arm.R": (60, 15),
        "forearm.L": (30,), "forearm.R": (30,),
    }, {"up": -0.1}),
    (14, {
        "spine": (5,), "head": (-55,),
        "thigh.L": (-5,), "thigh.R": (-12,), "shin.L": (-20,), "shin.R": (-30,),
        "upper_arm.L": (165, 20), "upper_arm.R": (165, 20),
        "forearm.L": (10,), "forearm.R": (10,),
    }, {"fwd": 0.3, "pitch": 65}, {"lift": 0.25}),
    (24, {
        "spine": (0,), "head": (-60,),
        "thigh.L": (-5,), "thigh.R": (-10,), "shin.L": (-35,), "shin.R": (-45,),
        "upper_arm.L": (160, 30), "upper_arm.R": (160, 30),
        "forearm.L": (20,), "forearm.R": (20,),
    }, {"fwd": 0.5, "pitch": 88}),
])

keyed("Fall", [
    (0, run(0.5)[0], None),
    (7, {
        "spine": (25,), "head": (-30,),
        "thigh.L": (35,), "thigh.R": (-20,), "shin.L": (-40,), "shin.R": (-50,),
        "upper_arm.L": (100, 40), "upper_arm.R": (100, 40),
        "forearm.L": (30,), "forearm.R": (30,),
    }, {"fwd": 0.1, "pitch": 30}, {"lift": 0.05}),
    (16, {
        "spine": (5,), "head": (-50,),
        "thigh.L": (5,), "thigh.R": (-5,), "shin.L": (-40,), "shin.R": (-60,),
        "upper_arm.L": (165, 55), "upper_arm.R": (165, 55),
        "forearm.L": (30,), "forearm.R": (30,),
    }, {"fwd": 0.4, "pitch": 88}),
    (24, {
        "spine": (0,), "head": (-40, 10),
        "thigh.L": (0,), "thigh.R": (-5,), "shin.L": (-50,), "shin.R": (-70,),
        "upper_arm.L": (170, 65), "upper_arm.R": (168, 60),
        "forearm.L": (45,), "forearm.R": (40,),
    }, {"fwd": 0.4, "pitch": 90}),
])

rig.animation_data.action = None
set_pose({})
bpy.context.view_layer.update()
print("CLIPS", CLIPS)
print("CAL", CAL, "UP", UP_AX, UP_SIGN, "FWD", FWD_AX, FWD_SIGN)

# ---------------------------------------------------------------- previews
if PREVIEW:
    out = HERE / "preview"
    out.mkdir(exist_ok=True)
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.0
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x = scene.render.resolution_y = 360
    shots = [("Idle", 0), ("Stance", 0), ("Run", 5), ("Run", 15), ("Throw", 10), ("Throw", 16),
             ("Catch", 6), ("Dive", 24), ("Fall", 24), ("Celebrate", 12), ("Block", 0)]
    views = {"front": ((0.9, -3.2, 1.3), (0, 0, 0.7)), "side": ((-3.4, -0.6, 1.0), (0, -0.3, 0.6))}
    for clip, frame in shots:
        rig.animation_data.action = bpy.data.actions[clip]
        if hasattr(rig.animation_data, "action_suitable_slots") and rig.animation_data.action_suitable_slots:
            rig.animation_data.action_slot = rig.animation_data.action_suitable_slots[0]
        scene.frame_set(frame)
        for vname, (pos, target) in views.items():
            cam.location = pos
            d = Vector(target) - Vector(pos)
            cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
            scene.render.filepath = str(out / f"{clip}_{frame}_{vname}.png")
            bpy.ops.render.render(write_still=True)
    rig.animation_data.action = None
    bpy.data.objects.remove(cam)

# ---------------------------------------------------------------- export
GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
bpy.ops.export_scene.gltf(
    filepath=str(GLB_PATH),
    export_format="GLB",
    export_animation_mode="ACTIONS",
    export_force_sampling=True,
    export_yup=True,
)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
print("EXPORTED", GLB_PATH)
