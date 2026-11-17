#!/bin/sh
# Install this setup into Herdr's home.
#
#   git clone https://github.com/1Samuel7/pungitore-herdr.git
#   cd pungitore-herdr
#   ./install.sh
#
# Herdr reads everything from ~/.config/herdr-app (HERDR_APP_HOME picks
# another). This copies the mods, the layout, the themes, the keys and the
# settings there. What was there before is kept in a timestamped folder, and
# mods of your own that this repository does not have are left alone.
#
# Herdr has to be running for the new layout to show up; the app applies the
# layout and the keys as they change, and the mods reload themselves.
set -eu

home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
here="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$home" ]; then
  echo "There is no $home yet. Install Herdr first (https://herdr.dev), run it" >&2
  echo "once, and try again." >&2
  exit 1
fi

stamp="$(date +%Y%m%d-%H%M%S)"
backup="$home/.backup-$stamp"
mkdir -p "$backup/mods" "$backup/layouts" "$backup/themes"

# Keep a copy of everything this setup is about to write over.
for file in keys.json settings.json; do
  [ -e "$home/$file" ] && cp "$home/$file" "$backup/$file" || true
done
[ -e "$home/layouts/herdr.json" ] && cp "$home/layouts/herdr.json" "$backup/layouts/herdr.json" || true

# The mods: each one from this repository replaces the one of the same name.
for mod in "$here/mods"/*; do
  [ -d "$mod" ] || continue
  name="$(basename "$mod")"
  if [ -e "$home/mods/$name" ]; then
    cp -R "$home/mods/$name" "$backup/mods/$name"
    rm -rf "$home/mods/$name"
  fi
  cp -R "$mod" "$home/mods/$name"
done

mkdir -p "$home/layouts" "$home/themes"
cp -R "$here/themes/." "$home/themes/"
cp "$here/layouts/herdr.json" "$home/layouts/herdr.json"
cp "$here/keys.json" "$home/keys.json"
cp "$here/settings.json" "$home/settings.json"

echo "Installed into $home"
echo "What was there before is in $backup"
echo
echo "Now show the layout:"
echo
echo "  herdr-app do layout.switch '{\"name\": \"herdr\"}'"
