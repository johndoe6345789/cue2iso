FROM nginxinc/nginx-unprivileged:1.27-alpine
LABEL org.opencontainers.image.source="https://github.com/johndoe6345789/cue2iso" \
      org.opencontainers.image.description="CUE/BIN to ISO converter. Static page, converts in the browser." \
      org.opencontainers.image.licenses="MIT"
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/index.html site/style.css site/convert.js site/app.js /usr/share/nginx/html/
