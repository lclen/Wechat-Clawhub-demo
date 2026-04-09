import type { SetupRole } from "../../../types";

type QuickSetupRolePanelProps = {
  availableRoles: SetupRole[];
  selectedRole: SetupRole | null;
  completedRoles: Set<SetupRole>;
  onSelectRole: (role: SetupRole) => void;
  roleName: (role: SetupRole) => string;
  roleDescription: (role: SetupRole) => string;
  roleAction: (role: SetupRole) => string;
};

export function QuickSetupRolePanel({
  availableRoles,
  selectedRole,
  completedRoles,
  onSelectRole,
  roleName,
  roleDescription,
  roleAction,
}: QuickSetupRolePanelProps) {
  return (
    <section className="surface">
      <div className="section-head"><div><div className="section-kicker">角色选择</div><h3>这台机器现在要扮演什么角色？</h3></div></div>
      <div className="role-card-grid">
        {availableRoles.map((role) => (
          <button key={role} type="button" className={`role-card ${selectedRole === role ? "role-card-active" : ""}`} onClick={() => onSelectRole(role)}>
            <div className="role-card-top">
              <strong>{roleName(role)}</strong>
              {completedRoles.has(role) ? <span className="session-badge session-badge-human">已配置</span> : null}
            </div>
            <div className="role-card-copy">{roleDescription(role)}</div>
            <div className="role-card-meta">{roleAction(role)}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
