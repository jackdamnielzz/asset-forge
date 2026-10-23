# Changelog

What changed in each version of Asset Forge, in plain words.

## 0.2.0: safer, sturdier and better-looking (2026-10-24)

This version comes from a full review of the project. It fixes about 50 problems: some in security, some that
could lose work, and many smaller ones that made results look wrong. Nothing you made before needs to change.
`npm test` now checks 26 more things, including the ready-made example scenes.

### Safer when sharing
These mostly matter when Asset Forge is shared on a network with a password.

- The "only on this computer" rules (no file paths, no AI-key changes) now also apply to commands inside
  `run_batch` and to every command a generator runs. Before, `run_batch` could get around them.
- Export folders can no longer contain `..`, so files cannot be written outside `workspace/exports` (or the Godot project).
- Only this computer's own addresses are accepted as host names. This blocks websites that try to pose as "local"
  (DNS rebinding).
- A malformed request can no longer crash the engine.
- After 5 wrong passwords through the API (Bearer), that address is locked out for a minute, just like the log-in page.
- From another computer, Asset Forge will not download from this computer or its local network. Every download now
  stops after 2 minutes or 500 MB.
- Changing an AI service's address removes its saved key, so a key never goes to a new address by accident.
  The fal.ai key is only sent to fal.ai's own address.
- Text from a project file can no longer run code in the window.
- AI apps (MCP) only see commands that just look as "read-only". Generators, file actions and paid AI services
  are no longer marked read-only, so an AI app asks before running them.

### Protecting your work
- "Save project as" refuses a name that is already taken, unless you pass `overwrite: true` (the old project is kept
  as a version first). Undo afterwards stays in the new project.
- Undo, redo and switching projects wait for changes that are still running, so they cannot get mixed up.
- A project file that was copied under a new name saves to its own file.
- Scenes that are loaded (`load_scene`, project files, old versions) are checked and repaired. A broken reference no
  longer causes errors later.
- Keyboard shortcuts no longer act on the 3D scene while a pop-up is open. Before, Ctrl+Z or Backspace in the pixel
  editor also changed the scene behind it.
- A missing picture, font or model no longer makes rendering hang. Before, it retried about 1000 times per second.
- Imported models cannot be cut (you get a clear message). A failed cut no longer breaks drawing until a restart.
- Damaged `.vox` files and backups that went wrong give a clear message instead of crashing or claiming success.
- Deleting a library picture or model that the open project still uses asks first (`force: true`). Objects whose
  picture is gone can still be edited.

### Results that look right
- Recipes and library items keep parts that share a name apart. A table with three legs called "leg" now comes back
  with three legs.
- A copy of something with a hole gets its own hole. This also applies to repeat, mirror and variations.
- `remake` keeps the object's animations, its place in the list and its variation link.
- Colour names (`"blue"`, `"orange"`) and short colours (`"#f80"`) are stored as proper colours. Variations and house
  styles no longer turn them almost black. House styles leave voxel models and pictures their own colours.
- "Outline" (extrude) and cut-out shapes are centred properly, so the sword's groove shows.
- "Open once" animations (e.g. a door) end open in Godot instead of snapping shut on the last frame.
- Patterns on voxel models have the right size. Rocks with a picture no longer stretch after resizing.
- "Remove background" keeps dark outlines on pictures that are already see-through. Parallax mountains and forests
  tile without a jump. "Picture to blocks" no longer leaves holes in pictures with many colours.
- Objects with the same name get their own export file (`post.glb`, `post_2.glb`) instead of overwriting each other.

### Generators
- The seed now changes the lamp post, coin, potion, sword, level kit and character too. For example, characters get
  different skin, hair and clothes. Seed 1 keeps the familiar look.
- The character's helmet is visible again and sits above the eyes.
- The chest's metal parts grow and shrink with the chest.
- The level kit's door and window fit low walls and small grids.
- Coin symbols of up to 3 characters fit on the coin, and stacks look more natural.
- The sword's blade width follows its length.
- Rock moss follows the rock's shape, with a natural edge.
- The crate uses the shared generator toolkit. It gains a `rotation` option and colour checks; existing crates come
  out exactly the same.

### Smaller improvements
- The hidden renderer keeps only recently used materials in memory, so long sessions no longer keep using more.
- Renders always put the window back the way it was, even if something fails halfway. The 1.8 m size person no
  longer appears in sprite sheets.
- The quality check's tip about pure black or white works again. A kept variation keeps the original's size.
- After deleting a cut object, its cutter becomes a normal visible shape again.
- On the command line, `name=2024` stays text instead of becoming a number.
- PixelLab results show the right picture with its real file type. Aseprite export explains its frame limit.
- The window: new pictures show right away, selections and panels stay correct after deleting, and the house-style
  list retries after a failed load.
- The documentation (PLAN.md, CLAUDE.md, README, API docs) matches the code again.

### For developers
- Remote-caller limits live in `commandLimit()` (`src/server/access.js`) and run inside `Engine.execute` via
  `engine.guard` for every call with `meta.remote`. Always pass `ctx.meta` on to nested commands.
- New: `checkScene()` in `src/core/commands/common.js`, `Engine.exclusive()` for queue-safe actions, and
  `src/shared/colors.js` (`toHex`).
- `delete_library_item` and `save_project_as` have new options (`force`, `overwrite`).

## 0.1.0: first version (2026-10-23)

Phases 1 to 8 from [PLAN.md](PLAN.md): the command engine with MCP, HTTP, OpenAPI and a command line; materials,
looks and effects; shapes, cuts and 13 generators; animations, sprite sheets and Godot export; AI services and
pixel-art tools; recipes, variations and house styles; voxels and effects; the asset library, sharing and the
Windows app.
