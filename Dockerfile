FROM node:18

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

RUN npm install

# Bundle app source
COPY . .

# Create public directory if it doesn't exist
RUN mkdir -p public

# Move client code to public directory if it's not already there
RUN if [ -f client-code.html ] && [ ! -f public/index.html ]; then cp client-code.html public/index.html; fi

# Your app binds to port 3000 as defined in server.js
EXPOSE 3000

CMD [ "node", "server.js" ]
