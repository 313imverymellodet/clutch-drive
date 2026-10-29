"""
Builds the chibi players: low-poly meshes, armature, face rig, body-type shape keys, gear, animation clips.
Exports blender/export/player.glb and saves blender/player.blend; `npm run pack-models` then writes the
compressed public/models/player.glb the app loads.

Run:  /Applications/Blender.app/Contents/MacOS/Blender -b --python blender/build_player.py
      add `-- --preview` to also render PNG previews into blender/preview/
      add `-- --hoops` for the basketball player (no helmet, tank top, shorts, hoops clips):
      exports blender/export/hoops.glb and blender/hoops.blend

Conventions (Blender, Z up): character faces -Y, its left side is +X.
Material names (Jersey, Pants, Helmet, Stripe, ...) are what the web app recolors per team.

V2:
- Face rig: `eyes` (blink = scale along the bone), `mouth` (open = scale), `brow.L` / `brow.R` (tilt, raise).
  Every clip keys a face, so a celebration opens the mouth and a missed tackle grimaces.
- Shape keys `Heavy` and `Lean` on every mesh: the app dials body type per position (linemen, guards, bigs).
- Gear and hair are separate skinned meshes the app shows or hides per player:
  football: Visor, Towel, Sleeve, EyeBlack.   hoops: HairShort, HairFade, HairAfro, HairTwists, HairBun,
  Headband, Beard, Sleeve.
"""
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
HOOPS = "--hoops" in sys.argv
# raw export; `npm run pack-models` compresses it (meshopt) into public/models/
GLB_PATH = HERE / "export" / ("hoops.glb" if HOOPS else "player.glb")
BLEND_PATH = HERE / ("hoops.blend" if HOOPS else "player.blend")
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
    "Shine": (1.0, 1.0, 1.0),
    "Mouth": (0.36, 0.09, 0.1),
    "Glove": (0.95, 0.95, 0.95),
    "Socks": (0.95, 0.95, 0.95),
    "Shoe": (0.08, 0.08, 0.1),
    "Hair": (0.1, 0.07, 0.05),
    "Visor": (0.06, 0.07, 0.1),
    "Towel": (0.97, 0.97, 0.97),
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
# parts are collected per output object: "Player" is the body, everything else is optional gear/hair
GROUPS = {}
CURRENT = ["Player"]


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
    GROUPS.setdefault(CURRENT[0], []).append(obj)
    return obj


def group(name):
    CURRENT[0] = name


def cube(loc, size, mat, bone, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    return finish(bpy.context.active_object, mat, bone, scale=size)


def cyl(loc, r, depth, mat, bone, verts=8, rot=(0, 0, 0), scale=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    return finish(bpy.context.active_object, mat, bone, scale=scale)


def cone(loc, r1, r2, depth, mat, bone, verts=8, scale=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    return finish(bpy.context.active_object, mat, bone, scale=scale)


def sphere(loc, r, mat, bone, seg=10, rings=7, scale=None, keep=None):
    """keep(co) -> bool trims the sphere (in local, unscaled coordinates) before it's placed."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=(0, 0, 0))
    obj = bpy.context.active_object
    if keep:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v.co)], context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
    obj.location = loc
    return finish(obj, mat, bone, scale=scale)


def torus(loc, major, minor, mat, bone, scale=None, rot=(0, 0, 0), seg=16):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=seg,
                                     minor_segments=4, location=loc, rotation=rot)
    return finish(bpy.context.active_object, mat, bone, scale=scale)


def face(eye_z, eye_y, mouth, brow, eye_x=0.075, blush=None):
    """Eyes with a catch-light, a mouth and brows, each on its own face bone."""
    for sx in (1, -1):
        sphere((eye_x * sx, eye_y, eye_z), 0.034, "Eye", "eyes", seg=10, rings=7, scale=(1, 0.5, 1.15))
        sphere((eye_x * sx + 0.012, eye_y - 0.016, eye_z + 0.014), 0.0095, "Shine", "eyes", seg=6, rings=4)
        side = "L" if sx > 0 else "R"
        bx, by, bz = brow
        cube((bx * sx, by, bz), (0.07, 0.014, 0.017), "Hair", f"brow.{side}")
        if blush:
            sphere((blush[0] * sx, blush[1], blush[2]), 0.03, "Blush", "head", seg=8, rings=5, scale=(1.3, 0.4, 0.8))
    sphere(mouth, 0.03, "Mouth", "mouth", seg=10, rings=6, scale=(1.5, 0.45, 0.55))


def hand(ax, sx, z, mat):
    """A mitt with a thumb pointing forward and in."""
    sphere((ax, -0.005, z), 0.062, mat, f"forearm.{'L' if sx > 0 else 'R'}", seg=10, rings=7, scale=(0.85, 1.05, 1.0))
    sphere((ax - 0.032 * sx, -0.045, z + 0.022), 0.026, mat, f"forearm.{'L' if sx > 0 else 'R'}", seg=6, rings=5)


if HOOPS:
    FACE_EYE_Z, FACE_EYE_Y, MOUTH_C, BROW_C = 1.2, -0.255, (0, -0.238, 1.098), (0.083, -0.243, 1.272)
    # basketball: bare arms and legs, tank top, long shorts, low socks, chunky sneakers; hair is gear
    for side, sx in (("L", 1), ("R", -1)):
        x = 0.11 * sx
        cube((x, -0.04, 0.05), (0.135, 0.24, 0.1), "Shoe", f"foot.{side}")
        cube((x, -0.05, 0.008), (0.14, 0.25, 0.018), "Socks", f"foot.{side}")  # white midsole
        cyl((x, 0, 0.125), 0.058, 0.08, "Socks", f"shin.{side}")
        cone((x, 0, 0.23), 0.045, 0.055, 0.17, "Skin", f"shin.{side}")
        cone((x, 0, 0.43), 0.08, 0.092, 0.3, "Pants", f"thigh.{side}")
        cube((0.19 * sx, 0, 0.43), (0.014, 0.07, 0.26), "Stripe", f"thigh.{side}")
        torus((x, 0, 0.29), 0.083, 0.011, "Stripe", f"thigh.{side}")  # hem trim
        ax = 0.26 * sx
        cone((ax, 0, 0.85), 0.048, 0.058, 0.22, "Skin", f"upper_arm.{side}")
        cone((ax, 0, 0.65), 0.04, 0.05, 0.2, "Skin", f"forearm.{side}")
        hand(ax, sx, 0.53, "Skin")
        sphere((0.255 * sx, 0.0, 1.18), 0.05, "Skin", "head", seg=8, rings=6, scale=(0.6, 1, 1))  # ears

    cube((0, 0, 0.6), (0.36, 0.23, 0.17), "Pants", "hips")
    cube((0, -0.116, 0.66), (0.37, 0.01, 0.035), "Stripe", "hips")  # waistband
    cone((0, 0, 0.8), 0.17, 0.205, 0.36, "Jersey", "spine", verts=10, scale=(1, 0.72, 1))
    sphere((0, 0, 0.965), 0.205, "Jersey", "spine", seg=12, rings=6, scale=(1, 0.66, 0.3))
    for sx in (1, -1):
        cube((0.172 * sx, 0, 0.8), (0.012, 0.13, 0.3), "Stripe", "spine", rot=(0, math.radians(-6 * sx), 0))  # side panels
    cyl((0, 0, 0.99), 0.075, 0.08, "Skin", "spine")  # neck
    torus((0, 0, 0.985), 0.095, 0.015, "Stripe", "spine", scale=(1, 0.75, 1))  # collar trim
    sphere((0, 0, 1.2), 0.26, "Skin", "head", seg=16, rings=11)
    face(FACE_EYE_Z, FACE_EYE_Y, MOUTH_C, BROW_C, blush=(0.13, -0.215, 1.12))
    sphere((0, -0.262, 1.16), 0.028, "Skin", "head", seg=8, rings=5, scale=(1, 0.7, 0.8))  # nose

    # ---- hair styles (the app shows one, or none for a bald player)
    group("HairShort")
    sphere((0, 0.035, 1.255), 0.264, "Hair", "head", seg=16, rings=10, scale=(1.02, 1.0, 0.86),
           keep=lambda co: co.z > -0.05 or co.y > -0.05)
    group("HairFade")
    sphere((0, 0.03, 1.29), 0.262, "Hair", "head", seg=16, rings=10, scale=(1.0, 0.98, 0.7),
           keep=lambda co: co.z > 0.02 or co.y > 0.05)
    group("HairAfro")
    sphere((0, 0.07, 1.36), 0.33, "Hair", "head", seg=16, rings=10, scale=(1.05, 1.0, 0.95),
           keep=lambda co: (co.z > -0.08 or co.y > 0.04) and not (co.y < -0.2 and co.z < 0.02))
    group("HairTwists")
    sphere((0, 0.035, 1.255), 0.264, "Hair", "head", seg=16, rings=10, scale=(1.02, 1.0, 0.86),
           keep=lambda co: co.z > -0.05 or co.y > -0.05)
    for i in range(11):
        a = i / 11 * math.tau
        rr = 0.12 if i % 2 else 0.17
        x, y = rr * math.sin(a), 0.03 + rr * math.cos(a)
        tilt = math.atan2(rr, 0.32)
        cyl((x, y, 1.43 - rr * 0.35), 0.032, 0.14, "Hair", "head", verts=6,
            rot=(-tilt * math.cos(a), tilt * math.sin(a), 0))
    cyl((0, 0.03, 1.46), 0.034, 0.12, "Hair", "head", verts=6)
    group("HairBun")
    sphere((0, 0.035, 1.255), 0.264, "Hair", "head", seg=16, rings=10, scale=(1.02, 1.0, 0.86),
           keep=lambda co: co.z > -0.05 or co.y > -0.05)
    sphere((0, 0.13, 1.47), 0.09, "Hair", "head", seg=10, rings=7)
    # ---- gear
    group("Headband")
    torus((0, 0.0, 1.33), 0.232, 0.026, "Stripe", "head", scale=(1, 0.98, 1), seg=20)
    group("Beard")
    sphere((0, -0.004, 1.19), 0.27, "Hair", "head", seg=16, rings=11, scale=(0.99, 1.0, 1.0),
           keep=lambda co: co.z < -0.118 and co.y < 0.06)
    group("Sleeve")
    cone((-0.26, 0, 0.85), 0.054, 0.064, 0.22, "Stripe", "upper_arm.R")
    cone((-0.26, 0, 0.65), 0.046, 0.056, 0.2, "Stripe", "forearm.R")
    group("Player")

else:
    FACE_EYE_Z, FACE_EYE_Y, MOUTH_C, BROW_C = 1.21, -0.29, (0, -0.296, 1.128), (0.08, -0.29, 1.258)
    for side, sx in (("L", 1), ("R", -1)):
        x = 0.11 * sx
        # legs: cleats with a white sole, tall socks, padded pants with a side stripe
        cube((x, -0.035, 0.045), (0.125, 0.22, 0.085), "Shoe", f"foot.{side}")
        cube((x, -0.04, 0.006), (0.13, 0.23, 0.014), "Socks", f"foot.{side}")
        cone((x, 0, 0.2), 0.05, 0.06, 0.26, "Socks", f"shin.{side}")
        cone((x, 0, 0.45), 0.075, 0.085, 0.26, "Pants", f"thigh.{side}")
        sphere((x, -0.06, 0.37), 0.06, "Pants", f"thigh.{side}", seg=8, rings=6, scale=(1, 0.7, 0.9))  # knee pad
        cube((0.183 * sx, 0, 0.46), (0.014, 0.05, 0.24), "Stripe", f"thigh.{side}")
        # arms: short sleeve with stripes under the pads, bare forearm, glove
        ax = 0.27 * sx
        cone((ax, 0, 0.86), 0.052, 0.066, 0.2, "Jersey", f"upper_arm.{side}")
        torus((ax, 0, 0.8), 0.058, 0.011, "Stripe", f"upper_arm.{side}")
        torus((ax, 0, 0.83), 0.061, 0.009, "Stripe", f"upper_arm.{side}")
        cone((ax, 0, 0.65), 0.04, 0.05, 0.2, "Skin", f"forearm.{side}")
        hand(ax, sx, 0.53, "Glove")

    # hips + torso + shoulder pads
    cube((0, 0, 0.6), (0.34, 0.22, 0.16), "Pants", "hips")
    cube((0, -0.112, 0.665), (0.35, 0.01, 0.03), "Stripe", "hips")  # belt
    cone((0, 0, 0.79), 0.16, 0.205, 0.36, "Jersey", "spine", verts=10, scale=(1, 0.72, 1))
    sphere((0, 0, 0.965), 0.31, "Jersey", "spine", seg=14, rings=8, scale=(1.08, 0.62, 0.36))  # pads
    sphere((0, 0.005, 0.99), 0.2, "Jersey", "spine", seg=12, rings=6, scale=(1, 0.8, 0.4))
    cyl((0, 0, 1.04), 0.085, 0.07, "Mask", "spine", verts=10)  # neck roll
    # head: big helmet, face peeking out, a proper cage, chin strap, stripe
    sphere((0, 0, 1.22), 0.275, "Helmet", "head", seg=16, rings=11, scale=(1, 1.04, 1))
    sphere((0, 0.035, 1.235), 0.282, "Stripe", "head", seg=16, rings=11, scale=(0.18, 1.04, 1),
           keep=lambda co: co.y > -0.15 or co.z > 0.1)
    for sx in (1, -1):
        cyl((0.272 * sx, 0.01, 1.2), 0.055, 0.02, "Mask", "head", verts=10, rot=(0, math.radians(90), 0))  # ear hole
    sphere((0, -0.12, 1.17), 0.19, "Skin", "head", seg=14, rings=10)
    face(FACE_EYE_Z, FACE_EYE_Y, MOUTH_C, BROW_C, blush=(0.125, -0.255, 1.13))
    torus((0, -0.13, 1.045), 0.2, 0.014, "Mask", "head", scale=(1, 1, 1), seg=18)
    torus((0, -0.13, 1.105), 0.205, 0.012, "Mask", "head", seg=18)
    cyl((0, -0.335, 1.085), 0.012, 0.12, "Mask", "head", verts=6)  # center bar
    cube((0, -0.3, 1.0), (0.12, 0.05, 0.03), "Mask", "head")  # chin cup
    # ---- gear
    group("Visor")
    sphere((0, -0.07, 1.2), 0.245, "Visor", "head", seg=16, rings=10, scale=(1, 1, 0.9),
           keep=lambda co: co.y < -0.2 and abs(co.z) < 0.085)
    group("Towel")
    cube((0.15, -0.1, 0.52), (0.07, 0.012, 0.14), "Towel", "hips", rot=(0, 0, math.radians(-18)))
    group("Sleeve")
    cone((0.27, 0, 0.65), 0.046, 0.056, 0.21, "Stripe", "forearm.L")
    group("EyeBlack")
    for sx in (1, -1):
        cube((0.075 * sx, -0.302, 1.168), (0.05, 0.01, 0.016), "Eye", "head", rot=(math.radians(-12), 0, 0))
    group("Player")


# join each group into one object (body = "Player", gear/hair keep their group names)
OBJECTS = {}
for gname, parts in GROUPS.items():
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = gname
    ob.data.name = f"{gname}Mesh"
    OBJECTS[gname] = ob
body = OBJECTS["Player"]

# ---------------------------------------------------------------- body-type shape keys
# Heavy: wider, deeper torso and thicker limbs (linemen, bigs). Lean: the other way (receivers, guards).
LIMB_AXES = {}
for side, sx in (("L", 1), ("R", -1)):
    ax = (0.26 if HOOPS else 0.27) * sx
    LIMB_AXES[f"upper_arm.{side}"] = (ax, 0, 1.0)
    LIMB_AXES[f"forearm.{side}"] = (ax, 0, 1.0)
    LIMB_AXES[f"thigh.{side}"] = (0.11 * sx, 0, 0.0)
    LIMB_AXES[f"shin.{side}"] = (0.11 * sx, 0, 0.0)


def body_shape(co, bone, k):
    """k = +1 heavy, -1 lean. Returns the moved coordinate."""
    x, y, z = co
    if bone in ("spine", "hips"):
        sx_, sy_ = (1.3, 1.26) if k > 0 else (0.85, 0.88)
        return Vector((x * sx_, y * sy_, z))
    if bone in LIMB_AXES:
        cx, cy, push = LIMB_AXES[bone]
        f = 1.32 if k > 0 else 0.82
        out = (0.06 if k > 0 else -0.025) * push * (1 if cx > 0 else -1)
        return Vector((cx + (x - cx) * f + out, cy + (y - cy) * f, z))
    if bone.startswith("foot") and k > 0:
        return Vector((x * 1.06, y, z))
    return Vector((x, y, z))


for ob in OBJECTS.values():
    ob.shape_key_add(name="Basis")
    groups = {g.index: g.name for g in ob.vertex_groups}
    for name, k in (("Heavy", 1), ("Lean", -1)):
        sk = ob.shape_key_add(name=name, from_mix=False)
        for v in ob.data.vertices:
            bone = groups[v.groups[0].group]
            sk.data[v.index].co = body_shape(v.co, bone, k)

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
    # face: each points up, so scaling along the bone squashes vertically around its head
    ("eyes", (0, FACE_EYE_Y, FACE_EYE_Z), (0, FACE_EYE_Y, FACE_EYE_Z + 0.08), "head"),
    ("mouth", MOUTH_C, (MOUTH_C[0], MOUTH_C[1], MOUTH_C[2] + 0.06), "head"),
]
for side, sx in (("L", 1), ("R", -1)):
    ax = (0.26 if HOOPS else 0.27) * sx
    BONES += [
        (f"brow.{side}", (BROW_C[0] * sx, BROW_C[1], BROW_C[2]), (BROW_C[0] * sx, BROW_C[1], BROW_C[2] + 0.05), "head"),
        (f"upper_arm.{side}", (ax, 0, 0.95), (ax, 0, 0.75), "spine"),
        (f"forearm.{side}", (ax, 0, 0.75), (ax, 0, 0.55), f"upper_arm.{side}"),
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

for ob in OBJECTS.values():
    ob.parent = rig
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = rig

FACE_BONES = ("eyes", "mouth", "brow.L", "brow.R")

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
SIDE_AX = 3 - UP_AX - FWD_AX
SIDE_SIGN = 1 if loc_d[SIDE_AX].x > 0 else -1
# a face bone's own "up" (along the bone) for blink/open scale and brow raise
ALONG = 1  # Blender bones point along local +Y
bpy.context.view_layer.update()

# ---------------------------------------------------------------- posing helpers
R = math.radians
FACE_DEFAULT = {"blink": 1.0, "mouth": 0.55, "brow": 6.0, "raise": 0.0, "wide": 1.0}


def _apply(spec, root_spec):
    for pb in PB:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    face_spec = {**FACE_DEFAULT, **spec.get("_face", {})}
    for name, vals in spec.items():
        if name == "_face":
            continue
        vals = tuple(vals) + (0,) * (3 - len(vals))
        e = [0.0, 0.0, 0.0]
        for key, deg in zip(("swing", "spread", "twist"), vals):
            ax, sgn = CAL[name][key]
            e[ax] += R(deg) * sgn
        PB[name].rotation_euler = e
    # face
    sc = [1.0, 1.0, 1.0]
    sc[ALONG] = max(0.08, face_spec["blink"])
    PB["eyes"].scale = sc
    sc = [face_spec["wide"], face_spec["wide"], face_spec["wide"]]
    sc[ALONG] = face_spec["mouth"] / 0.55
    PB["mouth"].scale = sc
    for side in ("L", "R"):
        pb = PB[f"brow.{side}"]
        ax, sgn = CAL[pb.name]["spread"]
        e = [0.0, 0.0, 0.0]
        e[ax] = -R(face_spec["brow"]) * sgn  # positive brow = inner ends down (determined)
        pb.rotation_euler = e
        loc = [0.0, 0.0, 0.0]
        loc[ALONG] = face_spec["raise"]
        pb.location = loc
    r = root_spec or {}
    loc = [0.0, 0.0, 0.0]
    loc[UP_AX] = r.get("up", 0) * UP_SIGN
    loc[FWD_AX] = r.get("fwd", 0) * FWD_SIGN
    loc[SIDE_AX] = r.get("side", 0) * SIDE_SIGN
    root.location = loc
    e = [0.0, 0.0, 0.0]
    if "pitch" in r:
        ax, sgn = CAL["root"]["swing"]
        e[ax] += R(r["pitch"]) * sgn
    if "roll" in r:
        ax, sgn = CAL["root"]["spread"]
        e[ax] += R(r["roll"]) * sgn
    if "yaw" in r:
        ax, sgn = CAL["root"]["twist"]
        e[ax] += R(r["yaw"]) * sgn
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
        if pb.name in FACE_BONES:
            pb.keyframe_insert("scale", frame=frame, group=pb.name)


def mirror(spec):
    """Swap .L/.R entries (twist and spread flip sign for centre bones)."""
    out = {}
    for k, v in spec.items():
        if k == "_face":
            out[k] = v
            continue
        v = tuple(v) + (0,) * (3 - len(v))
        if k.endswith(".L"):
            out[k[:-2] + ".R"] = v
        elif k.endswith(".R"):
            out[k[:-2] + ".L"] = v
        else:
            out[k] = (v[0], -v[1], -v[2])
    return out


def with_face(spec, **f):
    return {**spec, "_face": {**spec.get("_face", {}), **f}}


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


def blink_at(t, at=0.78, width=0.05):
    """1 = open; a quick blink centred on `at` (fraction of the loop)."""
    d = abs(t - at)
    return 1.0 if d > width else 0.1 + 0.9 * (d / width)


# ---------------------------------------------------------------- clips (both sports)
def idle(t):
    p = t * TAU
    return ({
        "hips": (0, 0, 2 * s(p)),
        "spine": (3 + 1.5 * s(p), 0, -2 * s(p)),
        "head": (-2 * s(p), 3 * s(p), 4 * s(p * 0.5)),
        "thigh.L": (2 + 2 * s(p), 2), "thigh.R": (2 - 2 * s(p), 2),
        "shin.L": (-4,), "shin.R": (-4,),
        "upper_arm.L": (4 + 2 * s(p), 10 + 2 * s(p)),
        "upper_arm.R": (4 + 2 * s(p), 10 + 2 * s(p)),
        "forearm.L": (15,), "forearm.R": (15,),
        "_face": {"blink": blink_at(t), "brow": 4},
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
        "_face": {"brow": 16, "blink": blink_at(t, 0.4), "mouth": 0.4},
    }, None)


sampled("Stance", 60, stance, step=3)


def ready(t):
    """Athletic crouch: linebackers and DBs before the snap, a little bounce on the toes."""
    p = t * TAU
    b = s(p * 2)
    return ({
        "hips": (22,), "spine": (24 + b,), "head": (-34 - b,),
        "thigh.L": (52 + 2 * b, 14), "thigh.R": (52 - 2 * b, 14), "shin.L": (-62,), "shin.R": (-62,),
        "upper_arm.L": (38, 16), "upper_arm.R": (38, 16), "forearm.L": (42,), "forearm.R": (42,),
        "_face": {"brow": 18, "mouth": 0.4, "blink": blink_at(t, 0.6)},
    }, None, {"lift": 0.012 * (0.5 + 0.5 * b)})


sampled("Ready", 40, ready, step=2)


def run(t):
    p = t * TAU
    return ({
        "hips": (6, 0, -6 * s(p)),
        "spine": (16, 0, 10 * s(p)), "head": (-14, 0, -7 * s(p)),
        "thigh.L": (12 + 46 * s(p),), "thigh.R": (12 - 46 * s(p),),
        "shin.L": (-22 - 62 * (0.5 + 0.5 * c(p)),), "shin.R": (-22 - 62 * (0.5 - 0.5 * c(p)),),
        "upper_arm.L": (5 - 55 * s(p), 14), "upper_arm.R": (5 + 55 * s(p), 14),
        "forearm.L": (88 + 12 * s(p),), "forearm.R": (88 - 12 * s(p),),
        "_face": {"brow": 14, "mouth": 0.7},
    }, None, {"lift": 0.04 * abs(c(p))})


sampled("Run", 20, run)


def run_ball(t):
    """Ball carrier: right arm locks the ball high and tight, left arm pumps."""
    spec, r, opts = run(t)
    p = t * TAU
    spec.update({
        "upper_arm.R": (28, 4, -12), "forearm.R": (125,),
        "upper_arm.L": (10 + 60 * s(p), 22), "forearm.L": (80 + 12 * s(p),),
        "spine": (20, 0, 8 * s(p)),
        "_face": {"brow": 20, "mouth": 0.9},
    })
    return spec, r, opts


sampled("RunBall", 20, run_ball)


def backpedal(t):
    """Low and quick going backwards: DBs in coverage."""
    p = t * TAU
    return ({
        "hips": (22,), "spine": (26, 0, 4 * s(p)), "head": (-34,),
        "thigh.L": (45 - 22 * s(p), 6), "thigh.R": (45 + 22 * s(p), 6),
        "shin.L": (-70 + 18 * c(p),), "shin.R": (-70 - 18 * c(p),),
        "upper_arm.L": (30 + 25 * s(p), 16), "upper_arm.R": (30 - 25 * s(p), 16),
        "forearm.L": (70,), "forearm.R": (70,),
        "_face": {"brow": 18, "mouth": 0.45},
    }, None, {"lift": 0.02 * abs(s(p))})


sampled("Backpedal", 16, backpedal, step=2)


def shuffle(t):
    """Lateral shuffle: feet slide apart and together, hips low, hands ready."""
    p = t * TAU
    w = 0.5 + 0.5 * c(p)
    return ({
        "hips": (20,), "spine": (22,), "head": (-30,),
        "thigh.L": (48, 8 + 22 * w), "thigh.R": (48, 8 + 22 * (1 - w)),
        "shin.L": (-62,), "shin.R": (-62,),
        "upper_arm.L": (40, 30), "upper_arm.R": (40, 30), "forearm.L": (45,), "forearm.R": (45,),
        "_face": {"brow": 18, "mouth": 0.45},
    }, None, {"lift": 0.03 * abs(s(p))})


sampled("Shuffle", 14, shuffle, step=2)


def block(t):
    p = t * TAU
    return ({
        "hips": (20,), "spine": (22,), "head": (-32,),
        "thigh.L": (60 + 10 * s(p), 12), "thigh.R": (60 - 10 * s(p), 12),
        "shin.L": (-75 - 10 * s(p),), "shin.R": (-75 + 10 * s(p),),
        "upper_arm.L": (85 + 10 * s(p * 2), 10), "upper_arm.R": (85 - 10 * s(p * 2), 10),
        "forearm.L": (40 - 15 * s(p * 2),), "forearm.R": (40 + 15 * s(p * 2),),
        "_face": {"brow": 24, "mouth": 0.9 + 0.3 * abs(s(p * 2)), "blink": 0.75},
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
        "_face": {"mouth": 1.9, "brow": -8, "raise": 0.012, "wide": 1.15},
    }, None, {"lift": 0.28 * h})


sampled("Celebrate", 24, celebrate, step=2)


def dance(t):
    """Touchdown dance: hip sway, arms rolling, knees bouncing."""
    p = t * TAU
    return ({
        "hips": (6, 0, 16 * s(p)), "spine": (4, 8 * s(p), -20 * s(p)), "head": (-8, -6 * s(p), 10 * s(p)),
        "thigh.L": (20 + 15 * s(p), 10), "thigh.R": (20 - 15 * s(p), 10),
        "shin.L": (-35 - 15 * s(p),), "shin.R": (-35 + 15 * s(p),),
        "upper_arm.L": (70 + 40 * s(p), 30), "upper_arm.R": (70 - 40 * s(p), 30),
        "forearm.L": (110 - 30 * s(p),), "forearm.R": (110 + 30 * s(p),),
        "_face": {"mouth": 1.6, "brow": -6, "raise": 0.008, "blink": blink_at(t, 0.3)},
    }, None, {"lift": 0.04 * abs(s(p * 2))})


sampled("Dance", 24, dance, step=2)


def flex(t):
    """Both arms up, biceps out, chest puffed; a small bounce."""
    p = t * TAU
    b = 0.5 + 0.5 * s(p * 2)
    return ({
        "spine": (-6,), "head": (-12 - 4 * b, 0, 0),
        "thigh.L": (6, 14), "thigh.R": (6, 14), "shin.L": (-12,), "shin.R": (-12,),
        "upper_arm.L": (8, 84), "upper_arm.R": (8, 84),
        "forearm.L": (10, 105 + 12 * b), "forearm.R": (10, 105 + 12 * b),
        "_face": {"mouth": 1.4 + 0.4 * b, "brow": 18, "wide": 1.2},
    }, None, {"lift": 0.02 * b})


sampled("Flex", 30, flex, step=3)


def dejected(t):
    """Hands on the head, staring at the sky: the other team just did it."""
    p = t * TAU
    b = s(p)
    return ({
        "spine": (-4 + 2 * b,), "head": (-26 + 3 * b, 0, 6 * s(p * 0.5)),
        "thigh.L": (4, 6), "thigh.R": (4, 6), "shin.L": (-8,), "shin.R": (-8,),
        "upper_arm.L": (18, 138), "upper_arm.R": (18, 138),
        "forearm.L": (5, 112), "forearm.R": (5, 112),
        "_face": {"mouth": 0.9, "brow": -22, "raise": 0.006, "blink": 0.85 if 0.3 < t < 0.36 else 1.0},
    }, None)


sampled("Dejected", 60, dejected, step=3)


def clap(t):
    """Teammates on the bench / behind the play: quick claps."""
    p = t * TAU
    k = 0.5 + 0.5 * c(p)
    return ({
        "spine": (4,), "head": (-8,),
        "thigh.L": (4, 4), "thigh.R": (4, 4), "shin.L": (-8,), "shin.R": (-8,),
        "upper_arm.L": (62, 8 + 22 * k, 10), "upper_arm.R": (62, 8 + 22 * k, 10),
        "forearm.L": (65,), "forearm.R": (65,),
        "_face": {"mouth": 1.3, "brow": -4},
    }, None)


sampled("Clap", 12, clap, step=2)

READY_QB = {
    "spine": (6,), "head": (-4,),
    "upper_arm.R": (55, 18), "forearm.R": (75,),
    "upper_arm.L": (45, -5), "forearm.L": (85,),
    "thigh.L": (8,), "thigh.R": (-4,), "shin.L": (-10,), "shin.R": (-10,),
    "_face": {"brow": 12},
}
keyed("Throw", [
    (0, READY_QB, {"up": -0.01}),
    (10, {
        "spine": (-6, 0, -35), "head": (-6, 0, 30),
        "upper_arm.R": (-15, 85), "forearm.R": (100,),
        "upper_arm.L": (80, 5), "forearm.L": (15,),
        "thigh.L": (28,), "shin.L": (-12,), "thigh.R": (-12,), "shin.R": (-8,),
        "_face": {"brow": 16, "mouth": 0.4},
    }, {"up": -0.02}),
    (16, {
        "spine": (14, 0, 22), "head": (0, 0, -15),
        "upper_arm.R": (165, 30), "forearm.R": (15,),
        "upper_arm.L": (25, 25), "forearm.L": (70,),
        "thigh.L": (25,), "shin.L": (-15,), "thigh.R": (-18,), "shin.R": (-25,),
        "_face": {"brow": 20, "mouth": 1.2},
    }, {"up": -0.03}),
    (24, {
        "spine": (26, 0, 32), "head": (-10, 0, -20),
        "upper_arm.R": (55, -20), "forearm.R": (35,),
        "upper_arm.L": (15, 25), "forearm.L": (60,),
        "thigh.L": (22,), "shin.L": (-20,), "thigh.R": (5,), "shin.R": (-40,),
        "_face": {"brow": 10, "mouth": 0.8},
    }, {"up": -0.04}),
    (36, {**idle(0)[0]}, None),
])


def shotgun(t):
    """QB waiting on the snap: knees soft, hands out for the ball, eyes up reading the D."""
    p = t * TAU
    b = s(p)
    return ({
        "hips": (10,), "spine": (12 + b,), "head": (-16 - b, 0, 14 * s(p * 0.5)),
        "thigh.L": (22, 12), "thigh.R": (22, 12), "shin.L": (-32,), "shin.R": (-32,),
        "upper_arm.L": (48, 12), "upper_arm.R": (48, 12), "forearm.L": (62,), "forearm.R": (62,),
        "_face": {"brow": 14, "blink": blink_at(t, 0.55)},
    }, None)


sampled("Shotgun", 60, shotgun, step=3)

keyed("Catch", [
    (0, run(0.25)[0], {"up": 0.0}),
    (6, {
        "spine": (-6,), "head": (-25,),
        "upper_arm.L": (145, 8), "upper_arm.R": (145, 8),
        "forearm.L": (15,), "forearm.R": (15,),
        "thigh.L": (20,), "shin.L": (-40,), "thigh.R": (-10,), "shin.R": (-30,),
        "_face": {"brow": 10, "mouth": 0.9, "raise": 0.008},
    }, {"up": 0.05}),
    (11, {
        "spine": (-4,), "head": (-20,),
        "upper_arm.L": (135, 6), "upper_arm.R": (135, 6),
        "forearm.L": (30,), "forearm.R": (30,),
        "thigh.L": (15,), "shin.L": (-35,), "thigh.R": (-5,), "shin.R": (-30,),
        "_face": {"brow": 10, "mouth": 1.1},
    }, {"up": 0.03}),
    (18, {
        "spine": (10,), "head": (-8,),
        "upper_arm.R": (25, 4), "forearm.R": (115,),
        "upper_arm.L": (45, -12), "forearm.L": (100,),
        "thigh.L": (10,), "shin.L": (-25,), "thigh.R": (0,), "shin.R": (-25,),
        "_face": {"brow": 16},
    }, {"up": 0.0}),
    (24, {
        "spine": (12,), "head": (-10,),
        "upper_arm.R": (25, 4), "forearm.R": (115,),
        "upper_arm.L": (45, -12), "forearm.L": (100,),
        "_face": {"brow": 16},
    }, None),
])

keyed("Dive", [
    (0, run(0.0)[0], None),
    (6, {
        "hips": (10,), "spine": (32,), "head": (-30,),
        "thigh.L": (50,), "thigh.R": (50,), "shin.L": (-75,), "shin.R": (-75,),
        "upper_arm.L": (60, 15), "upper_arm.R": (60, 15),
        "forearm.L": (30,), "forearm.R": (30,),
        "_face": {"brow": 24, "mouth": 1.2},
    }, {"up": -0.1}),
    (14, {
        "spine": (5,), "head": (-55,),
        "thigh.L": (-5,), "thigh.R": (-12,), "shin.L": (-20,), "shin.R": (-30,),
        "upper_arm.L": (165, 20), "upper_arm.R": (165, 20),
        "forearm.L": (10,), "forearm.R": (10,),
        "_face": {"brow": 20, "mouth": 1.7, "blink": 0.6},
    }, {"fwd": 0.3, "pitch": 65}, {"lift": 0.25}),
    (24, {
        "spine": (0,), "head": (-60,),
        "thigh.L": (-5,), "thigh.R": (-10,), "shin.L": (-35,), "shin.R": (-45,),
        "upper_arm.L": (160, 30), "upper_arm.R": (160, 30),
        "forearm.L": (20,), "forearm.R": (20,),
        "_face": {"brow": 10, "mouth": 1.0, "blink": 0.3},
    }, {"fwd": 0.5, "pitch": 88}),
])

keyed("Tackle", [
    (0, run(0.0)[0], None),
    (5, {
        "hips": (18,), "spine": (36,), "head": (-38,),
        "thigh.L": (62,), "thigh.R": (40,), "shin.L": (-82,), "shin.R": (-70,),
        "upper_arm.L": (55, 30), "upper_arm.R": (55, 30), "forearm.L": (50,), "forearm.R": (50,),
        "_face": {"brow": 28, "mouth": 1.3, "blink": 0.7},
    }, {"up": -0.08}),
    (11, {
        "spine": (12,), "head": (-50,),
        "thigh.L": (10,), "thigh.R": (-20,), "shin.L": (-30,), "shin.R": (-20,),
        "upper_arm.L": (110, -8, 20), "upper_arm.R": (110, -8, 20), "forearm.L": (85,), "forearm.R": (85,),
        "_face": {"brow": 28, "mouth": 1.8, "blink": 0.5, "wide": 1.1},
    }, {"fwd": 0.25, "pitch": 45}, {"lift": 0.15}),
    (18, {
        "spine": (8,), "head": (-58,),
        "thigh.L": (-6,), "thigh.R": (-14,), "shin.L": (-40,), "shin.R": (-55,),
        "upper_arm.L": (120, -12, 25), "upper_arm.R": (120, -12, 25), "forearm.L": (100,), "forearm.R": (100,),
        "_face": {"brow": 20, "mouth": 1.4, "blink": 0.3},
    }, {"fwd": 0.45, "pitch": 84}),
    (26, {
        "spine": (4,), "head": (-50, 8),
        "thigh.L": (-4,), "thigh.R": (-10,), "shin.L": (-55,), "shin.R": (-65,),
        "upper_arm.L": (125, -10, 25), "upper_arm.R": (125, -10, 25), "forearm.L": (95,), "forearm.R": (95,),
        "_face": {"brow": 12, "mouth": 0.9, "blink": 0.5},
    }, {"fwd": 0.5, "pitch": 90}),
])

keyed("Fall", [
    (0, run(0.5)[0], None),
    (7, {
        "spine": (25,), "head": (-30,),
        "thigh.L": (35,), "thigh.R": (-20,), "shin.L": (-40,), "shin.R": (-50,),
        "upper_arm.L": (100, 40), "upper_arm.R": (100, 40),
        "forearm.L": (30,), "forearm.R": (30,),
        "_face": {"brow": -10, "mouth": 1.8, "blink": 0.4, "wide": 1.1},
    }, {"fwd": 0.1, "pitch": 30}, {"lift": 0.05}),
    (16, {
        "spine": (5,), "head": (-50,),
        "thigh.L": (5,), "thigh.R": (-5,), "shin.L": (-40,), "shin.R": (-60,),
        "upper_arm.L": (165, 55), "upper_arm.R": (165, 55),
        "forearm.L": (30,), "forearm.R": (30,),
        "_face": {"brow": -14, "mouth": 1.3, "blink": 0.2},
    }, {"fwd": 0.4, "pitch": 88}),
    (24, {
        "spine": (0,), "head": (-40, 10),
        "thigh.L": (0,), "thigh.R": (-5,), "shin.L": (-50,), "shin.R": (-70,),
        "upper_arm.L": (170, 65), "upper_arm.R": (168, 60),
        "forearm.L": (45,), "forearm.R": (40,),
        "_face": {"brow": -10, "mouth": 0.8, "blink": 0.5},
    }, {"fwd": 0.4, "pitch": 90}),
])


# ---------------------------------------------------------------- football-only clips
if not HOOPS:
    def juke(direction):
        """Plant and cut: the body drops and leans hard toward the cut; outside leg pushes off."""
        sgn = 1 if direction == "L" else -1
        plant = "R" if direction == "L" else "L"
        lead = direction
        base = run_ball(0.25)[0]
        cut = {
            **base,
            "hips": (18, 0, 0), "spine": (22, 18 * sgn, 0), "head": (-26, -10 * sgn, 0),
            f"thigh.{plant}": (30, 38), f"shin.{plant}": (-25,),
            f"thigh.{lead}": (55, 4), f"shin.{lead}": (-85,),
            "upper_arm.L": (40, 40 if sgn > 0 else 60), "forearm.L": (60,),
            "_face": {"brow": 24, "mouth": 1.2},
        }
        cut["upper_arm.R"] = (28, 4, -12)
        cut["forearm.R"] = (125,)
        keyed(f"Juke{direction}", [
            (0, base, None),
            (4, cut, {"roll": 14 * sgn}),
            (8, cut, {"roll": 16 * sgn}),
            (12, run_ball(0.5)[0], None),
        ])

    juke("L")
    juke("R")

    def spin(t):
        """A full 360 through contact, ball tucked, low center of gravity."""
        spec, r, opts = run_ball(t * 1.5 % 1)
        spec = {**spec, "spine": (24,), "hips": (16,), "upper_arm.L": (55, 50), "forearm.L": (70,),
                "_face": {"brow": 24, "mouth": 1.1, "blink": 0.8}}
        return spec, {"yaw": -360 * (t * t * (3 - 2 * t))}, {"lift": 0.03}

    sampled("Spin", 14, spin)

    keyed("Slide", [
        (0, run_ball(0.25)[0], None),
        (6, {
            "spine": (-18,), "head": (-6,),
            "thigh.L": (65,), "shin.L": (-10,), "thigh.R": (40,), "shin.R": (-80,),
            "upper_arm.R": (28, 4, -12), "forearm.R": (125,), "upper_arm.L": (-20, 30), "forearm.L": (20,),
            "_face": {"brow": 6, "mouth": 0.9},
        }, {"pitch": -25}),
        (14, {
            "spine": (-4,), "head": (10,),
            "thigh.L": (85,), "shin.L": (-5,), "thigh.R": (80,), "shin.R": (-60,),
            "upper_arm.R": (28, 4, -12), "forearm.R": (125,), "upper_arm.L": (-30, 25), "forearm.L": (10,),
            "_face": {"brow": 4, "mouth": 0.7},
        }, {"pitch": -55, "fwd": 0.25}),
        (24, {
            "spine": (6,), "head": (16,),
            "thigh.L": (88,), "shin.L": (-5,), "thigh.R": (84,), "shin.R": (-50,),
            "upper_arm.R": (28, 4, -12), "forearm.R": (125,), "upper_arm.L": (-25, 25), "forearm.L": (20,),
            "_face": {"brow": 4, "mouth": 0.6},
        }, {"pitch": -60, "fwd": 0.35}),
    ])

    keyed("Spike", [
        (0, {**READY_QB, "upper_arm.R": (60, 10), "forearm.R": (80,)}, None),
        (6, {
            "spine": (-4,), "head": (-10,),
            "upper_arm.R": (165, 12), "forearm.R": (20,), "upper_arm.L": (30, 25), "forearm.L": (60,),
            "thigh.L": (12,), "shin.L": (-15,),
            "_face": {"brow": 18, "mouth": 1.0},
        }, None),
        (10, {
            "spine": (30,), "head": (-30,),
            "upper_arm.R": (25, 8), "forearm.R": (5,), "upper_arm.L": (20, 30), "forearm.L": (60,),
            "thigh.L": (35,), "shin.L": (-40,), "thigh.R": (-5,), "shin.R": (-20,),
            "_face": {"brow": 22, "mouth": 1.5},
        }, None),
        (24, {**idle(0)[0], "_face": {"brow": 10}}, None),
    ])


# ---------------------------------------------------------------- basketball clips
if HOOPS:
    def defend(t):
        p = t * TAU
        b = 2 * s(p)
        return ({
            "hips": (18,), "spine": (16 + b,), "head": (-26 - b,),
            "thigh.L": (55, 22), "thigh.R": (55, 22), "shin.L": (-70,), "shin.R": (-70,),
            "upper_arm.L": (45, 62 + 4 * s(p)), "upper_arm.R": (45, 62 - 4 * s(p)),
            "forearm.L": (25,), "forearm.R": (25,),
            "_face": {"brow": 20, "mouth": 0.45, "blink": blink_at(t, 0.7)},
        }, None)

    sampled("Defend", 40, defend, step=2)

    def def_slide(t):
        """Sliding on defense: wide base, feet slide together and apart, arms wide."""
        p = t * TAU
        w = 0.5 + 0.5 * c(p)
        return ({
            "hips": (18,), "spine": (18,), "head": (-26,),
            "thigh.L": (52, 14 + 24 * w), "thigh.R": (52, 14 + 24 * (1 - w)),
            "shin.L": (-68,), "shin.R": (-68,),
            "upper_arm.L": (40, 66 + 6 * s(p)), "upper_arm.R": (40, 66 - 6 * s(p)),
            "forearm.L": (25,), "forearm.R": (25,),
            "_face": {"brow": 22, "mouth": 0.5},
        }, None, {"lift": 0.03 * abs(s(p))})

    sampled("DefSlide", 14, def_slide, step=2)

    def dribble(t):
        p = t * TAU
        return ({
            "hips": (12,), "spine": (14, 0, 4 * s(p)), "head": (-16,),
            "thigh.L": (35, 10), "thigh.R": (35, 10), "shin.L": (-50,), "shin.R": (-50,),
            "upper_arm.R": (28 + 6 * s(p), 14), "forearm.R": (45 + 35 * (0.5 + 0.5 * s(p)),),
            "upper_arm.L": (55, 28), "forearm.L": (60,),
            "_face": {"brow": 14, "mouth": 0.5},
        }, None)

    sampled("Dribble", 16, dribble, step=2)

    SET = {
        "spine": (10,), "head": (-8,),
        "thigh.L": (40,), "thigh.R": (40,), "shin.L": (-62,), "shin.R": (-62,),
        "upper_arm.L": (95, 8), "upper_arm.R": (95, 8), "forearm.L": (85,), "forearm.R": (85,),
        "_face": {"brow": 16, "mouth": 0.4},
    }
    keyed("Shoot", [
        (0, SET, None),
        (7, {**SET, "thigh.L": (55,), "thigh.R": (55,), "shin.L": (-85,), "shin.R": (-85,), "spine": (14,)}, None),
        (13, {
            "spine": (2,), "head": (-12,),
            "thigh.L": (8,), "thigh.R": (8,), "shin.L": (-12,), "shin.R": (-12,),
            "upper_arm.L": (150, 12), "upper_arm.R": (155, 6), "forearm.L": (70,), "forearm.R": (95,),
            "_face": {"brow": 18, "mouth": 0.5},
        }, None, {"lift": 0.16}),
        (18, {
            "spine": (0,), "head": (-18,),
            "thigh.L": (4,), "thigh.R": (4,), "shin.L": (-18,), "shin.R": (-18,),
            "upper_arm.L": (150, 20), "upper_arm.R": (172, 4), "forearm.L": (55,), "forearm.R": (5,),
            "_face": {"brow": 12, "mouth": 0.6},
        }, None, {"lift": 0.27}),
        (25, {
            "spine": (2,), "head": (-15,),
            "thigh.L": (10,), "thigh.R": (10,), "shin.L": (-25,), "shin.R": (-25,),
            "upper_arm.L": (130, 22), "upper_arm.R": (168, 4), "forearm.L": (40,), "forearm.R": (30,),
            "_face": {"brow": 8, "mouth": 0.6, "raise": 0.005},
        }, None, {"lift": 0.14}),
        (33, {**idle(0)[0], "upper_arm.R": (60, 10), "forearm.R": (40,)}, None),
    ])

    keyed("Pass", [
        (0, {"spine": (8,), "upper_arm.L": (70, 14), "upper_arm.R": (70, 14), "forearm.L": (105,), "forearm.R": (105,), "thigh.L": (15,), "shin.L": (-25,)}, None),
        (5, {"spine": (14,), "upper_arm.L": (92, 4), "upper_arm.R": (92, 4), "forearm.L": (8,), "forearm.R": (8,), "thigh.L": (28,), "shin.L": (-22,), "thigh.R": (-10,),
             "_face": {"brow": 14, "mouth": 0.9}}, None),
        (14, {**idle(0)[0]}, None),
    ])

    keyed("Contest", [
        (0, defend(0)[0], None),
        (6, {"spine": (2,), "head": (-25,), "thigh.L": (10,), "thigh.R": (10,), "shin.L": (-20,), "shin.R": (-20,),
             "upper_arm.R": (172, 8), "forearm.R": (5,), "upper_arm.L": (120, 30), "forearm.L": (20,),
             "_face": {"brow": 26, "mouth": 1.4, "wide": 1.1}}, None, {"lift": 0.22}),
        (14, {"spine": (6,), "head": (-20,), "upper_arm.R": (165, 8), "forearm.R": (15,), "upper_arm.L": (90, 30), "forearm.L": (30,),
              "_face": {"brow": 20, "mouth": 1.0}}, None, {"lift": 0.04}),
        (22, defend(0)[0], None),
    ])

    keyed("Layup", [
        (0, run(0.25)[0], None),
        (8, {"spine": (4,), "head": (-25,), "thigh.L": (75,), "shin.L": (-80,), "thigh.R": (-10,), "shin.R": (-25,),
             "upper_arm.R": (165, 10), "forearm.R": (15,), "upper_arm.L": (90, 25), "forearm.L": (60,),
             "_face": {"brow": 16, "mouth": 0.8}}, None, {"lift": 0.32}),
        (14, {"spine": (2,), "head": (-30,), "thigh.L": (40,), "shin.L": (-60,), "thigh.R": (5,), "shin.R": (-20,),
              "upper_arm.R": (175, 6), "forearm.R": (2,), "upper_arm.L": (80, 25), "forearm.L": (60,),
              "_face": {"brow": 12, "mouth": 0.9}}, None, {"lift": 0.36}),
        (24, {**idle(0)[0]}, None),
    ])

    # the ball leaves the hand ~0.38 s in (frame 11), right at the top: then hang, then land
    keyed("Dunk", [
        (0, run(0.25)[0], None),
        (5, {"hips": (24,), "spine": (26,), "head": (-30,), "thigh.L": (70,), "thigh.R": (70,), "shin.L": (-95,), "shin.R": (-95,),
             "upper_arm.R": (50, 12), "forearm.R": (70,), "upper_arm.L": (50, 12), "forearm.L": (70,),
             "_face": {"brow": 26, "mouth": 0.9}}, None),
        # he glides at the rim in the air (fwd), then lands and steps back to his spot
        (10, {"spine": (-12,), "head": (-30,), "thigh.L": (35,), "shin.L": (-70,), "thigh.R": (10,), "shin.R": (-40,),
              "upper_arm.R": (185, 6), "forearm.R": (10,), "upper_arm.L": (170, 18), "forearm.L": (15,),
              "_face": {"brow": 28, "mouth": 1.7, "wide": 1.1}}, {"fwd": 0.35}, {"lift": 0.52}),
        (14, {"spine": (14,), "head": (-18,), "thigh.L": (45,), "shin.L": (-80,), "thigh.R": (25,), "shin.R": (-55,),
              "upper_arm.R": (135, 8), "forearm.R": (15,), "upper_arm.L": (150, 18), "forearm.L": (20,),
              "_face": {"brow": 26, "mouth": 2.0, "wide": 1.2}}, {"fwd": 0.55}, {"lift": 0.5}),
        (20, {"spine": (2,), "head": (-15,), "thigh.L": (20,), "shin.L": (-40,), "thigh.R": (15,), "shin.R": (-35,),
              "upper_arm.R": (160, 20), "forearm.R": (20,), "upper_arm.L": (160, 20), "forearm.L": (20,),
              "_face": {"brow": 10, "mouth": 1.8, "raise": 0.01}}, {"fwd": 0.5}, {"lift": 0.3}),
        (28, {"hips": (16,), "spine": (18,), "head": (-20,), "thigh.L": (50, 16), "thigh.R": (50, 16), "shin.L": (-70,), "shin.R": (-70,),
              "upper_arm.R": (40, 40), "forearm.R": (60,), "upper_arm.L": (40, 40), "forearm.L": (60,),
              "_face": {"brow": 20, "mouth": 1.6, "wide": 1.15}}, {"fwd": 0.2}),
        (34, {**idle(0)[0], "_face": {"brow": 14, "mouth": 1.4}}, None),
    ])

    def hold(t):
        """Holding the follow-through after a big three: gooseneck wrist, drifting back, eyes on the net."""
        p = t * TAU
        return ({
            "spine": (-4,), "head": (-20, 0, 4 * s(p)),
            "thigh.L": (8 + 6 * s(p), 4), "thigh.R": (8 - 6 * s(p), 4), "shin.L": (-14,), "shin.R": (-14,),
            "upper_arm.R": (172, 4), "forearm.R": (8,), "upper_arm.L": (20, 30), "forearm.L": (40,),
            "_face": {"brow": 4, "mouth": 1.0, "raise": 0.008, "blink": blink_at(t, 0.6)},
        }, None)

    sampled("Hold", 30, hold, step=3)

# the basketball model doesn't need the football-only clips (they were only built to share poses)
if HOOPS:
    for name in ("Stance", "Ready", "RunBall", "Backpedal", "Shuffle", "Throw", "Shotgun", "Dive", "Tackle", "Fall"):
        bpy.data.actions.remove(bpy.data.actions[name])
        CLIPS.remove(name)

rig.animation_data.action = None
set_pose({})
bpy.context.view_layer.update()
print("CLIPS", CLIPS)
print("CAL", CAL, "UP", UP_AX, UP_SIGN, "FWD", FWD_AX, FWD_SIGN, "SIDE", SIDE_AX, SIDE_SIGN)

# ---------------------------------------------------------------- previews
if PREVIEW:
    out = HERE / ("preview_hoops" if HOOPS else "preview")
    out.mkdir(exist_ok=True)
    for f in out.glob("*.png"):
        f.unlink()
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
    shots = [("Idle", 0), ("Shotgun", 0), ("Ready", 0), ("Run", 5), ("RunBall", 5), ("Backpedal", 4), ("Shuffle", 4),
             ("Throw", 16), ("Catch", 6), ("Tackle", 11), ("Tackle", 26), ("JukeL", 6), ("Spin", 7), ("Slide", 14),
             ("Spike", 10), ("Celebrate", 12), ("Dance", 6), ("Flex", 0), ("Dejected", 0), ("Clap", 3), ("Block", 0)]
    gear = {"Visor": True, "Towel": True, "Sleeve": True, "EyeBlack": False}
    if HOOPS:
        shots = [("Idle", 0), ("Defend", 0), ("DefSlide", 4), ("Run", 5), ("Dribble", 4), ("Shoot", 18), ("Pass", 5),
                 ("Contest", 6), ("Layup", 14), ("Dunk", 10), ("Dunk", 14), ("Hold", 0), ("Celebrate", 12), ("Flex", 0),
                 ("Dejected", 0), ("Clap", 3), ("Block", 0)]
        gear = {k: False for k in OBJECTS if k != "Player"}
        gear.update({"HairTwists": True, "Headband": True, "Sleeve": True, "Beard": True})
    for k, on in gear.items():
        OBJECTS[k].hide_render = not on
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
    # body types and hair, front close-ups
    rig.animation_data.action = bpy.data.actions["Idle"]
    scene.frame_set(0)
    cam.location, cam_data.ortho_scale = (0.5, -3.2, 1.2), 1.9
    cam.rotation_euler = (Vector((0, 0, 0.75)) - Vector(cam.location)).to_track_quat("-Z", "Y").to_euler()
    looks = [("heavy", {"Heavy": 1.0}, {}), ("lean", {"Lean": 1.0}, {})]
    if HOOPS:
        for h in ("HairShort", "HairFade", "HairAfro", "HairBun"):
            looks.append((h, {}, {h: True}))
    else:
        looks.append(("visor", {}, {"Visor": True, "EyeBlack": False}))
        looks.append(("eyeblack", {}, {"Visor": False, "EyeBlack": True}))
    for name, keys, show in looks:
        for ob in OBJECTS.values():
            for kb in ob.data.shape_keys.key_blocks[1:]:
                kb.value = keys.get(kb.name, 0.0)
        for k in gear:
            OBJECTS[k].hide_render = not show.get(k, False)
        scene.render.filepath = str(out / f"look_{name}.png")
        bpy.ops.render.render(write_still=True)
    for ob in OBJECTS.values():
        for kb in ob.data.shape_keys.key_blocks[1:]:
            kb.value = 0.0
        ob.hide_render = False
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
    export_morph=True,
    export_morph_normal=False,
    export_yup=True,
)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
print("EXPORTED", GLB_PATH)
