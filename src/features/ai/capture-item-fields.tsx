"use client";

import { Checkbox, DatePicker, Select, TimePicker } from "@/components/ui";
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
      <div>
        <span>Time zone</span>
        <Select
          value={item.timeZone}
          disabled={disabled}
          onChange={(value) =>
            onChange({ ...item, timeZone: value as "local" | "UTC" })
          }
          options={[
            { value: "local", label: "Workspace local time" },
            { value: "UTC", label: "UTC" },
          ]}
          ariaLabel="Time zone"
        />
      </div>
      {item.entityType === "task" ? (
        <>
          <div>
            <span>Due date</span>
            <DatePicker
              value={item.dueDate ?? ""}
              disabled={disabled}
              onChange={(value) => {
                const next = { ...item };
                if (value) next.dueDate = value;
                else {
                  delete next.dueDate;
                  delete next.dueTime;
                }
                onChange(next);
              }}
              ariaLabel="Due date"
            />
          </div>
          <div>
            <span>Due time</span>
            <TimePicker
              disabled={disabled || !item.dueDate}
              value={item.dueTime ?? ""}
              onChange={(value) => {
                const next = { ...item };
                if (value) next.dueTime = value;
                else delete next.dueTime;
                onChange(next);
              }}
              ariaLabel="Due time"
            />
          </div>
          <div>
            <span>Priority</span>
            <Select
              value={item.priority ?? ""}
              disabled={disabled}
              placeholder="None"
              onChange={(value) => {
                const next = { ...item };
                if (value)
                  next.priority = value as ProposedTaskCapture["priority"];
                else delete next.priority;
                onChange(next);
              }}
              options={[
                { value: "", label: "None" },
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
                { value: "urgent", label: "Urgent" },
              ]}
              ariaLabel="Priority"
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <Checkbox
              checked={item.allDay}
              disabled={disabled}
              label="All day"
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
          </div>
          <div>
            <span>Start date</span>
            <DatePicker
              value={item.startDate}
              disabled={disabled}
              onChange={(value) => onChange({ ...item, startDate: value })}
              ariaLabel="Start date"
            />
          </div>
          <div>
            <span>End date {item.allDay ? "(exclusive)" : ""}</span>
            <DatePicker
              value={item.endDate}
              disabled={disabled}
              onChange={(value) => onChange({ ...item, endDate: value })}
              ariaLabel="End date"
            />
          </div>
          {!item.allDay && (
            <>
              <div>
                <span>Start time</span>
                <TimePicker
                  value={item.startTime ?? ""}
                  disabled={disabled}
                  onChange={(value) =>
                    onChange({ ...item, startTime: value })
                  }
                  ariaLabel="Start time"
                />
              </div>
              <div>
                <span>End time</span>
                <TimePicker
                  value={item.endTime ?? ""}
                  disabled={disabled}
                  onChange={(value) =>
                    onChange({ ...item, endTime: value })
                  }
                  ariaLabel="End time"
                />
              </div>
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
