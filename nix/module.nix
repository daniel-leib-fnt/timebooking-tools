self:
{ config, lib, pkgs, ... }:

let
  cfg = config.programs.timebooking;
  system = pkgs.stdenv.hostPlatform.system;

  # The account settings go into the wrapper, not into session variables: plasmashell, which runs
  # the widget's commands, does not see Home Manager's session variables.
  wrapped = pkgs.symlinkJoin {
    name = "timebooking";
    paths = [ cfg.package ];
    nativeBuildInputs = [ pkgs.makeWrapper ];
    postBuild = ''
      wrapProgram $out/bin/timebooking \
        --set-default GFOS_URL ${lib.escapeShellArg cfg.url} \
        --set-default GFOS_MANDANT ${lib.escapeShellArg cfg.mandant} \
        --set-default GFOS_ORG_EINHEIT ${lib.escapeShellArg cfg.orgEinheit} \
        --set-default GFOS_PERSONALNUMMER ${lib.escapeShellArg cfg.personalnummer} \
        ${lib.optionalString (cfg.stampLog != null) "--set-default TIMEBOOKING_STAMP_LOG ${lib.escapeShellArg cfg.stampLog}"} \
        ${lib.optionalString cfg.alwaysRefresh "--set-default TIMEBOOKING_ALWAYS_REFRESH 1"}
    '';
    meta.mainProgram = "timebooking";
  };
in
{
  options.programs.timebooking = {
    enable = lib.mkEnableOption "the timebooking CLI and MCP server for GFOS, and its Plasma widget";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${system}.default;
      defaultText = lib.literalExpression "timebooking-tools.packages.\${system}.default";
      description = "The timebooking package.";
    };

    url = lib.mkOption {
      type = lib.types.str;
      description = "Base URL of the GFOS web application, e.g. https://gfos.example.com/gfos.";
    };

    mandant = lib.mkOption {
      type = lib.types.str;
      description = "GFOS Mandant, e.g. FNT.";
    };

    orgEinheit = lib.mkOption {
      type = lib.types.str;
      description = "GFOS OrgEinheit (Werk), e.g. D.";
    };

    personalnummer = lib.mkOption {
      type = lib.types.str;
      description = "GFOS Personalnummer. The password is read from the Secret Service (attribute service=gfos).";
    };

    alwaysRefresh = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Read every requested day from GFOS instead of the local day cache. When GFOS is not
        reachable, the cached data is still returned, marked as stale. By default only today and
        days that are not final yet are read from GFOS.
      '';
    };

    stampLog = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Where every stamp attempt is logged; default $XDG_STATE_HOME/timebooking/stamps.jsonl.";
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ wrapped self.packages.${system}.plasmoid ];
  };
}
