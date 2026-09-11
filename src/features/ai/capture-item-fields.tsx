"use client";
import type {
  ProposedTaskCapture,
  ProposedEventCapture,
} from "@/services/integrations/ai/quick-capture-contract";
import styles from "./capture-item-fields.module.css";
type Item = ProposedTaskCapture | ProposedEventCapture;
export function CaptureItemFields({
  item,
  onChange,
  disabled = false,
}: {
  item: Item;
  onChange: (item: Item) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className={styles.fields}>
      <legend>
        {item.entityType === "task" ? "Task details" : "Event details"}
      </legend>
      <label>
        Title
        <input
          value={item.title}
          maxLength={200}
          onChange={(e) => onChange({ ...item, title: e.target.value })}
        />
      </label>
      <label>
        Time zone
        <select
          value={item.timeZone}
          onChange={(e) =>
            onChange({ ...item, timeZone: e.target.value as "local" | "UTC" })
          }
        >
          <option value="local">Workspace local time</option>
          <option value="UTC">UTC</option>
        </select>
      </label>
      {item.entityType === "task" ? (
        <>
          <label>
            Due date
            <input
              type="date"
              value={item.dueDate ?? ""}
              onChange={(e) => {
                const next = { ...item };
                if (e.target.value) next.dueDate = e.target.value;
                else {
                  delete next.dueDate;
                  delete next.dueTime;
                }
                onChange(next);
              }}
            />
          </label>
          <label>
            Due time
            <input
              type="time"
              disabled={!item.dueDate}
              value={item.dueTime ?? ""}
              onChange={(e) => {
                const next = { ...item };
                if (e.target.value) next.dueTime = e.target.value;
                else delete next.dueTime;
                onChange(next);
              }}
            />
          </label>
          <label>
            Priority
            <select
              value={item.priority ?? ""}
              onChange={(e) => {
                const next = { ...item };
                if (e.target.value)
                  next.priority = e.target
                    .value as ProposedTaskCapture["priority"];
                else delete next.priority;
                onChange(next);
              }}
            >
              <option value="">None</option>
              {["low", "medium", "high", "urgent"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <label>
            <input
              type="checkbox"
              checked={item.allDay}
              onChange={(e) => {
                const next = { ...item, allDay: e.target.checked };
                if (next.allDay) {
                  delete next.startTime;
                  delete next.endTime;
                } else {
                  next.startTime = "09:00";
                  next.endTime = "10:00";
                }
                onChange(next);
              }}
            />
            All day
          </label>
          <label>
            Start date
            <input
              type="date"
              value={item.startDate}
              onChange={(e) => onChange({ ...item, startDate: e.target.value })}
            />
          </label>
          <label>
            End date {item.allDay ? "(exclusive)" : ""}
            <input
              type="date"
              value={item.endDate}
              onChange={(e) => onChange({ ...item, endDate: e.target.value })}
            />
          </label>
          {!item.allDay && (
            <>
              <label>
                Start time
                <input
                  type="time"
                  value={item.startTime ?? ""}
                  onChange={(e) =>
                    onChange({ ...item, startTime: e.target.value })
                  }
                />
              </label>
              <label>
                End time
                <input
                  type="time"
                  value={item.endTime ?? ""}
                  onChange={(e) =>
                    onChange({ ...item, endTime: e.target.value })
                  }
                />
              </label>
            </>
          )}
          <label>
            Location
            <input
              maxLength={200}
              value={item.location ?? ""}
              onChange={(e) => {
                const next = { ...item };
                if (e.target.value) next.location = e.target.value;
                else delete next.location;
                onChange(next);
              }}
            />
          </label>
        </>
      )}
    </fieldset>
  );
}
