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
      <div className="section-head">
        <div>
          <div className="section-kicker">选择本机角色</div>
          <h3>先决定这台机器承担哪一段链路</h3>
        </div>
        <span className="small-note">选择后只展示该角色需要填写的参数</span>
      </div>
      <div className="role-card-grid">
        {availableRoles.map((role) => (
          <button key={role} type="button" className={`role-card ${selectedRole === role ? "role-card-active" : ""}`} onClick={() => onSelectRole(role)}>
            <div className="role-card-top">
              <strong>{roleName(role)}</strong>
              {completedRoles.has(role) ? <span className="session-badge session-badge-human">已配置</span> : null}
            </div>
            <div className="role-card-copy">{roleDescription(role)}</div>
            <div className="role-card-meta">
              <span>{roleAction(role)}</span>
              <span className="role-card-arrow">继续</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
