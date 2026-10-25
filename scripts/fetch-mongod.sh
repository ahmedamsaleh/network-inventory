#!/usr/bin/env bash
#
# Provision a `mongod`-compatible binary for mongodb-memory-server in
# environments that cannot reach fastdl.mongodb.org (memory-server's
# download host).
#
# Outside such environments you do not need this: unset/skip it (set
# MONGOMS_USE_DOWNLOAD=1) and mongodb-memory-server downloads a real mongod.
#
# What it builds: a tiny wrapper `.cache/mongod/mongod` that runs
# mongo-java-server (an in-memory, wire-protocol compatible MongoDB
# implementation, fetched from Maven Central) advertising MongoDB 5.0, which
# is what the current mongodb driver (>= 4.4 required) needs. Requires a
# JDK >= 17 (javac + java).
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/.cache/mongod"
LIBS="$CACHE/libs"
WRAPPER="$CACHE/mongod"

if [ -n "${MONGOMS_USE_DOWNLOAD:-}" ] || [ -n "${MONGOMS_SYSTEM_BINARY:-}" ]; then
  echo "fetch-mongod: skipping (MONGOMS_USE_DOWNLOAD/MONGOMS_SYSTEM_BINARY set)"
  exit 0
fi

if [ -x "$WRAPPER" ] && "$WRAPPER" --version >/dev/null 2>&1; then
  echo "mongod shim already provisioned at $WRAPPER"
  exit 0
fi

command -v java >/dev/null || { echo "fetch-mongod: java not found" >&2; exit 1; }
command -v javac >/dev/null || { echo "fetch-mongod: javac not found" >&2; exit 1; }

javac_version="$(javac -version 2>&1)"
javac_major="$(printf '%s\n' "$javac_version" | sed -E 's/^[^0-9]*([0-9]+).*/\1/')"
java_version="$(java -version 2>&1 | sed -nE 's/.*version "([^"]+)".*/\1/p' | head -n 1)"
java_major="${java_version%%.*}"
if [[ "$java_version" == 1.* ]]; then
  java_major="${java_version#1.}"
  java_major="${java_major%%.*}"
fi

if ! [[ "$javac_major" =~ ^[0-9]+$ ]] || [ "$javac_major" -lt 17 ] ||
  ! [[ "$java_major" =~ ^[0-9]+$ ]] || [ "$java_major" -lt 17 ]; then
  echo "fetch-mongod: JDK 17 or newer is required (found javac $javac_version and java ${java_version:-unknown})." >&2
  echo "Install and select a JDK 17+ so both java and javac use it, or set MONGOMS_USE_DOWNLOAD=1 if MongoDB downloads are accessible." >&2
  exit 1
fi

mkdir -p "$LIBS" "$CACHE/classes"

MAVEN="https://repo1.maven.org/maven2"
MJS_VERSION="1.47.0"
NETTY_VERSION="4.2.2.Final"
SLF4J_VERSION="2.0.17"
ARTIFACTS=(
  "de/bwaldvogel/mongo-java-server-core/$MJS_VERSION/mongo-java-server-core-$MJS_VERSION.jar"
  "de/bwaldvogel/mongo-java-server-memory-backend/$MJS_VERSION/mongo-java-server-memory-backend-$MJS_VERSION.jar"
  "io/netty/netty-buffer/$NETTY_VERSION/netty-buffer-$NETTY_VERSION.jar"
  "io/netty/netty-codec/$NETTY_VERSION/netty-codec-$NETTY_VERSION.jar"
  "io/netty/netty-codec-base/$NETTY_VERSION/netty-codec-base-$NETTY_VERSION.jar"
  "io/netty/netty-codec-compression/$NETTY_VERSION/netty-codec-compression-$NETTY_VERSION.jar"
  "io/netty/netty-common/$NETTY_VERSION/netty-common-$NETTY_VERSION.jar"
  "io/netty/netty-handler/$NETTY_VERSION/netty-handler-$NETTY_VERSION.jar"
  "io/netty/netty-resolver/$NETTY_VERSION/netty-resolver-$NETTY_VERSION.jar"
  "io/netty/netty-transport/$NETTY_VERSION/netty-transport-$NETTY_VERSION.jar"
  "io/netty/netty-transport-native-unix-common/$NETTY_VERSION/netty-transport-native-unix-common-$NETTY_VERSION.jar"
  "org/slf4j/slf4j-api/$SLF4J_VERSION/slf4j-api-$SLF4J_VERSION.jar"
  "org/slf4j/slf4j-simple/$SLF4J_VERSION/slf4j-simple-$SLF4J_VERSION.jar"
)

for a in "${ARTIFACTS[@]}"; do
  name="$(basename "$a")"
  if [ ! -f "$LIBS/$name" ]; then
    echo "downloading $name"
    curl -fsSL -o "$LIBS/$name" "$MAVEN/$a"
  fi
done

javac --release 17 -cp "$LIBS/*" -d "$CACHE/classes" "$ROOT/scripts/mongod-shim/Launcher.java"

cat > "$WRAPPER" <<EOS
#!/usr/bin/env bash
exec java -Dorg.slf4j.simpleLogger.defaultLogLevel=warn -cp "$CACHE/classes:$LIBS/*" Launcher "\$@"
EOS
chmod +x "$WRAPPER"

"$WRAPPER" --version | head -n 1
echo "mongod shim provisioned at $WRAPPER"
