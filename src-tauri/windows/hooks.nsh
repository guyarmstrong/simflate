; Windows installer additions (Tauri NSIS hooks).
;
; The Reference engine runs as several copies started by Intel's MPI
; launcher. The launcher, its proxies and the engine open listening sockets
; on every address (Intel's launcher can't be told otherwise), so Windows
; asks "allow on public / private / domain networks?" for each the first
; time. Their traffic only ever goes over 127.0.0.1, which the firewall
; doesn't filter, so we register them up front as blocked from outside:
; no questions, nothing reachable from the network, Reference unchanged.

!macro SIMFLATE_FIREWALL_RULE NAME PROGRAM
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Simflate Reference: ${NAME}"'
  Pop $0
  nsExec::Exec 'netsh advfirewall firewall add rule name="Simflate Reference: ${NAME}" dir=in action=block profile=any enable=yes program="$INSTDIR\opencourant\${PROGRAM}"'
  Pop $0
!macroend

!macro SIMFLATE_FIREWALL_REMOVE NAME
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Simflate Reference: ${NAME}"'
  Pop $0
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro SIMFLATE_FIREWALL_RULE "launcher" "extlib\intelOneAPI_runtime\win64\mpiexec.exe"
  !insertmacro SIMFLATE_FIREWALL_RULE "proxy" "extlib\intelOneAPI_runtime\win64\hydra_pmi_proxy.exe"
  !insertmacro SIMFLATE_FIREWALL_RULE "bootstrap" "extlib\intelOneAPI_runtime\win64\hydra_bstrap_proxy.exe"
  !insertmacro SIMFLATE_FIREWALL_RULE "engine" "exec\Simflate Reference engine.exe"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro SIMFLATE_FIREWALL_REMOVE "launcher"
  !insertmacro SIMFLATE_FIREWALL_REMOVE "proxy"
  !insertmacro SIMFLATE_FIREWALL_REMOVE "bootstrap"
  !insertmacro SIMFLATE_FIREWALL_REMOVE "engine"
!macroend
