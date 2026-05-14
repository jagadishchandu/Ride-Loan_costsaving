FROM node:20-bookworm-slim

WORKDIR /app

# git is sometimes required by transitive deps; curl is useful for debugging
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl \
    && rm -rf /var/lib/apt/lists/*

# Cache dependencies layer
COPY package.json ./
# yarn.lock is optional in this repo — copy it only if present
COPY yarn.loc[k] ./
RUN yarn install --network-timeout 600000

# Now copy the rest of the app
COPY . .

# Make the entrypoint executable (it writes a docker-only .env.local so
# Expo Go on a real phone gets the right backend URL — see the script).
RUN chmod +x /app/docker-entrypoint.sh

# Expo / Metro ports
EXPOSE 8082 19008 19005 19006

# Bind Metro to 0.0.0.0 so the host (and Expo Go on LAN) can reach it.
# `--host lan` makes Expo print a tunnel-able URL using REACT_NATIVE_PACKAGER_HOSTNAME.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["sh", "-c", "yarn expo start --host lan --port 8082"]