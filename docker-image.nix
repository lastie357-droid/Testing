{ pkgs ? import <nixpkgs> {} }:

let
  appSrc = pkgs.runCommand "app-src" {} ''
    mkdir -p $out/app
    cp -r ${./backend} $out/app/backend
    cp -r ${./frps} $out/app/frps
    cp -r ${./frpc} $out/app/frpc
    chmod -R u+w $out/app
    # strip any baked-in secrets / local-only files — these must come from env at runtime
    rm -f $out/app/backend/.env $out/app/backend/.jwt_secret $out/app/backend/.jwt_secret_date
    rm -rf $out/app/backend/uploads $out/app/backend/logs
  '';
in
pkgs.dockerTools.streamLayeredImage {
  name = "kenyafisi/client";
  tag = "latest";

  contents = [
    pkgs.nodejs_22
    pkgs.bash
    pkgs.coreutils
    pkgs.tini
    pkgs.cacert
    pkgs.curl
    appSrc
  ];

  config = {
    Cmd = [ "node" "/app/backend/server.js" ];
    Entrypoint = [ "${pkgs.tini}/bin/tini" "--" ];
    WorkingDir = "/app";
    Env = [
      "NODE_ENV=production"
      "PORT=5000"
      "BUILD_URL=http://localhost:5000"
      "PATH=/bin:/usr/bin"
      "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
    ];
    ExposedPorts = {
      "5000/tcp" = {};
      "7000/tcp" = {};
      "6009/tcp" = {};
    };
  };
}
