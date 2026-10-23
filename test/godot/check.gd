extends SceneTree

# Loads everything Asset Forge exported and reports what Godot made of it.
var problems := 0

func report(ok: bool, what: String) -> void:
	print(("OK    " if ok else "FAIL  ") + what)
	if not ok:
		problems += 1

func count(node: Node, cls: String) -> int:
	var n := 1 if node.is_class(cls) else 0
	for c in node.get_children():
		n += count(c, cls)
	return n

func find_first(node: Node, cls: String) -> Node:
	if node.is_class(cls):
		return node
	for c in node.get_children():
		var f := find_first(c, cls)
		if f:
			return f
	return null

func _init() -> void:
	# 3D model with collision and animation
	var chest_scene = load("res://assets/forge/chest.glb")
	report(chest_scene is PackedScene, "chest.glb imports as a scene")
	if chest_scene:
		var chest: Node = chest_scene.instantiate()
		report(count(chest, "MeshInstance3D") > 10, "chest has its parts (%d meshes)" % count(chest, "MeshInstance3D"))
		report(count(chest, "StaticBody3D") >= 1 and count(chest, "CollisionShape3D") >= 1, "chest has a collision body (%d) and shape (%d)" % [count(chest, "StaticBody3D"), count(chest, "CollisionShape3D")])
		var shape_node = find_first(chest, "CollisionShape3D")
		if shape_node:
			report(shape_node.shape is ConvexPolygonShape3D, "chest collision is convex (%s)" % shape_node.shape.get_class())
		var player = find_first(chest, "AnimationPlayer")
		report(player != null and player.has_animation("open"), "chest has an AnimationPlayer with 'open' (%s)" % (str(player.get_animation_list()) if player else "none"))
		if player and player.has_animation("open"):
			var anim: Animation = player.get_animation("open")
			report(anim.get_track_count() >= 1 and anim.length > 1.9, "'open' has tracks (%d) and lasts %.1fs" % [anim.get_track_count(), anim.length])
		chest.free()

	# level kit pieces with exact (trimesh) collision
	for piece in ["floor", "wall", "wall_door", "wall_window", "pillar", "stairs"]:
		var s = load("res://assets/forge/kit/%s.glb" % piece)
		if s == null:
			report(false, "kit/%s.glb loads" % piece)
			continue
		var n: Node = s.instantiate()
		var shape_node = find_first(n, "CollisionShape3D")
		report(shape_node != null and shape_node.shape is ConcavePolygonShape3D, "kit/%s has exact collision (%s)" % [piece, shape_node.shape.get_class() if shape_node else "none"])
		n.free()

	# animated sprites
	var frames = load("res://assets/forge/sprites/hero.tres")
	report(frames is SpriteFrames, "hero.tres loads as SpriteFrames")
	if frames is SpriteFrames:
		var names: PackedStringArray = frames.get_animation_names()
		report(names.has("walk_left") and names.has("idle_down"), "hero animations: %s" % str(names))
		report(frames.get_frame_count("walk_down") == 4, "walk_down has 4 frames")
		var tex = frames.get_frame_texture("walk_down", 1)
		report(tex is AtlasTexture and tex.atlas is CanvasTexture and tex.atlas.normal_texture != null, "frames use the normal map for 2D lights")
		report(tex is AtlasTexture and tex.region.size == Vector2(32, 32), "frame region is 32x32 (%s)" % str(tex.region if tex is AtlasTexture else ""))
	var fire = load("res://assets/forge/effects/fire.tres")
	report(fire is SpriteFrames and fire.get_frame_count("fire") == 8, "fire effect has 8 frames")

	# tileset with terrains
	var ts = load("res://assets/forge/tiles/grass_dirt.tres")
	report(ts is TileSet, "grass_dirt.tres loads as TileSet")
	if ts is TileSet:
		report(ts.get_terrain_sets_count() == 1 and ts.get_terrains_count(0) == 2, "one terrain set with 2 terrains (%s / %s)" % [ts.get_terrain_name(0, 0), ts.get_terrain_name(0, 1)])
		report(ts.get_terrain_set_mode(0) == TileSet.TERRAIN_MODE_MATCH_CORNERS, "terrain mode is 'match corners'")
		var src: TileSetAtlasSource = ts.get_source(0)
		report(src.get_tiles_count() == 16, "atlas has 16 tiles (%d)" % src.get_tiles_count())
		var data: TileData = src.get_tile_data(Vector2i(1, 0), 0)  # index 1 = only top-left is grass
		report(data.get_terrain_peering_bit(TileSet.CELL_NEIGHBOR_TOP_LEFT_CORNER) == 1 and data.get_terrain_peering_bit(TileSet.CELL_NEIGHBOR_BOTTOM_RIGHT_CORNER) == 0, "corner bits are right for tile (1,0)")

	print("RESULT: %d problem(s)" % problems)
	quit(problems)
