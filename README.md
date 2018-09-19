# LightPoll
![Repository Size](https://img.shields.io/github/repo-size/JSN190/LightPoll.svg?t&style=flat-square)
![License](https://img.shields.io/github/license/JSN190/LightPoll.svg?&style=flat-square)
![Top Language](https://img.shields.io/github/languages/top/JSN190/LightPoll.svg?&style=flat-square)
![Website Uptime](https://img.shields.io/website-up-down-green-red/http/www.lightpoll.org.svg?label=lightpoll.org&style=flat-square)

LightPoll is a server-side web application that allows realtime online web polls to be created and shared instantaneously. It
exposes a RESTful JSON API that allows for full integration with any program or service and a Server-sent Events stream that 
instantly dispatches new poll data to connected clients as it has been processed.

It can either be deployed as a standalone backend application and API or as part of a full stack with an instance of 
[LightPoll Web](https://github.com/JSN190/LightPoll-Web) on the frontend. It is written with Node.js + Express.js and uses 
PostgreSQL to store data.

## Installation
Before deployment, set the following enviroment variables directly or via a `.env` file placed in the same directory as the
project and then run `npm install` to install dependencies.

Afterwards, start and daemonise `app.js` using a process manager such as `pm2` or `forever` once you've done a run of 
`npm run start` to observe the output and ensure everything is properly configured.

| Variable       | Description                                  
|----------------|--------------------------------------------------------------------|
|`LIGHTPOLL_PORT`| Port number to run the Express.js server from. 
|`LIGHTPOLL_DB`  | PostgreSQL [Connection URI String](https://www.postgresql.org/docs/current/static/libpq-connect.html#LIBPQ-CONNSTRING).|

## Lightpoll.org Frontend

And for demonstration purposes here's a demonstration of the LightPoll backend working with a frontend web application.

![Lightpoll.org Voting](https://i.imgur.com/w0335bd.gif)

## License
```
MIT License

Copyright (c) 2018 John Su

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
