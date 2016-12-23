FROM node:7

# Create app directory
RUN mkdir -p /usr/src/app/io
WORKDIR /usr/src/app/io

COPY . .

# Install app dependencies
RUN npm install

# Setup environment
ENV NODE_ENV production
ENV WEPLAY_PORT 8081
ENV WEPLAY_REDIS_URI "redis:6379"
ENV WEPLAY_REDIS "redis://redis:$REDIS_PORT_6379_TCP_PORT"

EXPOSE 8081

# Run
ENTRYPOINT [ "node", "index.js" ]