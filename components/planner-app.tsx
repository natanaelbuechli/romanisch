"use client";

import { FormEvent, TouchEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { DAYS, TIMES, type Appointment, type Day, type Entry, type TimeSlot, type Todo, type Week } from "@/lib/types";

const supabase = createBrowserSupabaseClient();

type EntryDrafts = Record<string, string>;
type TodoDrafts = Record<string, string>;
type AppointmentDraft = {
  title: string;
  time_label: string;
};
type AppointmentDrafts = Record<string, AppointmentDraft>;
type ActiveAppointmentEditor = {
  weekId: string;
  day: Day;
  appointmentId: string | null;
} | null;
type PlannerSearchResult = {
  id: string;
  weekId: string;
  type: "Unterricht" | "Termin";
  day: Day;
  content: string;
  detail: string | null;
};

const EMPTY_APPOINTMENT_DRAFT: AppointmentDraft = {
  title: "",
  time_label: ""
};

function getEntryKey(day: Day, time: TimeSlot) {
  return `${day}-${time}`;
}

function isSlotAvailable(day: Day, time: TimeSlot) {
  const disabledAfternoons: Day[] = ["Montag", "Mittwoch", "Freitag"];
  return !(time === "Nachmittag" && disabledAfternoons.includes(day));
}

function getShortDayLabel(day: Day) {
  const labels: Record<Day, string> = {
    Montag: "Mo",
    Dienstag: "Di",
    Mittwoch: "Mi",
    Donnerstag: "Do",
    Freitag: "Fr"
  };

  return labels[day];
}

function getShortTimeLabel(time: TimeSlot) {
  return time === "Morgen" ? "AM" : "PM";
}

function getDayDateLabel(weekStartDate: string, day: Day) {
  const offsets: Record<Day, number> = {
    Montag: 0,
    Dienstag: 1,
    Mittwoch: 2,
    Donnerstag: 3,
    Freitag: 4
  };

  const [year, month, dayOfMonth] = weekStartDate.split("-").map(Number);
  const date = new Date(year, month - 1, dayOfMonth);
  date.setDate(date.getDate() + offsets[day]);

  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit"
  }).format(date);
}

function buildEntryDrafts(entries: Entry[]) {
  return entries.reduce<EntryDrafts>((acc, entry) => {
    acc[getEntryKey(entry.day, entry.time)] = entry.content ?? "";
    return acc;
  }, {});
}

function buildTodoDrafts(todos: Todo[]) {
  return todos.reduce<TodoDrafts>((acc, todo) => {
    acc[todo.id] = todo.text ?? "";
    return acc;
  }, {});
}

function getAppointmentEditorKey(weekId: string, day: Day) {
  return `${weekId}-${day}`;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date(date));
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentWeekStartDate() {
  const now = new Date();
  const current = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = current.getDay();
  const distanceToMonday = day === 0 ? -6 : 1 - day;
  current.setDate(current.getDate() + distanceToMonday);
  return formatLocalDate(current);
}

function getCurrentDayLabel(): Day | null {
  const labels: Record<number, Day | null> = {
    0: null,
    1: "Montag",
    2: "Dienstag",
    3: "Mittwoch",
    4: "Donnerstag",
    5: "Freitag",
    6: null
  };

  return labels[new Date().getDay()] ?? null;
}

function getNextWeekData(weeks: Week[]) {
  const latestWeek = [...weeks].sort((a, b) => a.start_date.localeCompare(b.start_date)).at(-1);
  const baseDate = latestWeek ? new Date(latestWeek.start_date) : new Date();

  if (!latestWeek) {
    const day = baseDate.getDay();
    const distanceToMonday = day === 0 ? -6 : 1 - day;
    baseDate.setDate(baseDate.getDate() + distanceToMonday);
  } else {
    baseDate.setDate(baseDate.getDate() + 7);
  }

  const normalized = new Date(Date.UTC(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate()));
  const thursday = new Date(normalized);
  thursday.setUTCDate(normalized.getUTCDate() + 4 - (normalized.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);

  return {
    kw: weekNumber,
    start_date: normalized.toISOString().slice(0, 10)
  };
}

function getDefaultWeek(weeks: Week[], currentWeekStart: string) {
  const activeWeeks = weeks
    .filter((week) => !week.archived)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  return (
    activeWeeks.find((week) => week.start_date === currentWeekStart) ??
    activeWeeks.find((week) => week.start_date > currentWeekStart) ??
    activeWeeks.at(-1) ??
    weeks[0] ??
    null
  );
}

export function PlannerApp() {
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entryDrafts, setEntryDrafts] = useState<EntryDrafts>({});
  const [todos, setTodos] = useState<Todo[]>([]);
  const [todoDrafts, setTodoDrafts] = useState<TodoDrafts>({});
  const [todoDraft, setTodoDraft] = useState("");
  const [showCompletedTodos, setShowCompletedTodos] = useState(false);
  const [showArchivedWeeks, setShowArchivedWeeks] = useState(false);
  const [draggedTodoId, setDraggedTodoId] = useState<string | null>(null);
  const [dragTodoOrder, setDragTodoOrder] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [entriesByWeek, setEntriesByWeek] = useState<Record<string, Entry[]>>({});
  const [appointmentsByWeek, setAppointmentsByWeek] = useState<Record<string, Appointment[]>>({});
  const [appointmentDrafts, setAppointmentDrafts] = useState<AppointmentDrafts>({});
  const [activeAppointmentEditor, setActiveAppointmentEditor] = useState<ActiveAppointmentEditor>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragAnimating, setIsDragAnimating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PlannerSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const deferredSearchQuery = useDeferredValue(searchQuery.trim());
  const saveTimers = useRef<Record<string, number>>({});
  const todoSaveTimers = useRef<Record<string, number>>({});
  const draggedTodoIdRef = useRef<string | null>(null);
  const dragTodoOrderRef = useRef<string[] | null>(null);
  const todoTouchHoldTimerRef = useRef<number | null>(null);
  const todoTouchStartYRef = useRef<number | null>(null);
  const selectedWeekIdRef = useRef<string | null>(null);
  const swipeStartXRef = useRef<number | null>(null);
  const swipeStartYRef = useRef<number | null>(null);
  const swipeLockedRef = useRef<"horizontal" | "vertical" | null>(null);
  const plannerViewportRef = useRef<HTMLDivElement | null>(null);

  const activeWeek = useMemo(
    () => weeks.find((week) => week.id === selectedWeekId) ?? null,
    [selectedWeekId, weeks]
  );

  const sortedWeeks = useMemo(() => {
    const currentWeekStart = getCurrentWeekStartDate();

    return [...weeks].sort((a, b) => {
      if (a.archived !== b.archived) {
        return a.archived ? 1 : -1;
      }

      const aIsCurrent = a.start_date === currentWeekStart;
      const bIsCurrent = b.start_date === currentWeekStart;

      if (aIsCurrent && !bIsCurrent) {
        return -1;
      }

      if (!aIsCurrent && bIsCurrent) {
        return 1;
      }

      return a.start_date.localeCompare(b.start_date);
    });
  }, [weeks]);

  const activeWeeks = useMemo(() => sortedWeeks.filter((week) => !week.archived), [sortedWeeks]);
  const archivedWeeks = useMemo(
    () => sortedWeeks.filter((week) => week.archived).sort((a, b) => b.start_date.localeCompare(a.start_date)),
    [sortedWeeks]
  );
  const currentWeekStart = useMemo(() => getCurrentWeekStartDate(), []);
  const currentDayLabel = useMemo(() => getCurrentDayLabel(), []);

  const activeWeekIndex = useMemo(
    () => activeWeeks.findIndex((week) => week.id === selectedWeekId),
    [activeWeeks, selectedWeekId]
  );
  const previousActiveWeek = activeWeekIndex > 0 ? activeWeeks[activeWeekIndex - 1] : null;
  const nextActiveWeek =
    activeWeekIndex >= 0 && activeWeekIndex < activeWeeks.length - 1
      ? activeWeeks[activeWeekIndex + 1]
      : null;
  const todayWeek = useMemo(
    () => getDefaultWeek(activeWeeks, currentWeekStart),
    [activeWeeks, currentWeekStart]
  );

  const visibleOpenTodos = useMemo(() => {
    const openTodos = todos.filter((todo) => !todo.completed);

    if (dragTodoOrder) {
      const orderById = new Map(dragTodoOrder.map((todoId, index) => [todoId, index]));
      return [...openTodos].sort(
        (a, b) =>
          (orderById.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (orderById.get(b.id) ?? Number.MAX_SAFE_INTEGER)
      );
    }

    return [...openTodos].sort((a, b) => a.position - b.position);
  }, [dragTodoOrder, todos]);

  const completedTodos = useMemo(
    () =>
      [...todos.filter((todo) => todo.completed)].sort((a, b) =>
        a.text.localeCompare(b.text, "de")
      ),
    [todos]
  );

  useEffect(() => {
    if (deferredSearchQuery.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let isCurrentSearch = true;
    const searchTimer = window.setTimeout(async () => {
      setIsSearching(true);
      const [entriesResult, appointmentsResult] = await Promise.all([
        supabase.from("entries").select("id, week_id, day, time, content"),
        supabase.from("appointments").select("id, week_id, day, title, time_label")
      ]);

      if (!isCurrentSearch) {
        return;
      }

      const searchError = entriesResult.error ?? appointmentsResult.error;
      if (searchError) {
        setError(searchError.message);
        setSearchResults([]);
        setIsSearching(false);
        return;
      }

      const needle = deferredSearchQuery.toLocaleLowerCase("de-CH");
      const matchingEntries: PlannerSearchResult[] = (entriesResult.data ?? [])
        .filter((entry) => entry.content.toLocaleLowerCase("de-CH").includes(needle))
        .map((entry) => ({
          id: `entry-${entry.id}`,
          weekId: entry.week_id,
          type: "Unterricht",
          day: entry.day as Day,
          content: entry.content,
          detail: entry.time
        }));
      const matchingAppointments: PlannerSearchResult[] = (appointmentsResult.data ?? [])
        .filter((appointment) =>
          `${appointment.title} ${appointment.time_label ?? ""}`.toLocaleLowerCase("de-CH").includes(needle)
        )
        .map((appointment) => ({
          id: `appointment-${appointment.id}`,
          weekId: appointment.week_id,
          type: "Termin",
          day: appointment.day as Day,
          content: appointment.title,
          detail: appointment.time_label
        }));
      const weekById = new Map(weeks.map((week) => [week.id, week]));
      const dayOrder = new Map(DAYS.map((day, index) => [day, index]));

      setSearchResults(
        [...matchingEntries, ...matchingAppointments]
          .filter((result) => weekById.has(result.weekId))
          .sort((a, b) => {
            const weekA = weekById.get(a.weekId);
            const weekB = weekById.get(b.weekId);
            const weekComparison = (weekB?.start_date ?? "").localeCompare(weekA?.start_date ?? "");
            return weekComparison || (dayOrder.get(a.day) ?? 0) - (dayOrder.get(b.day) ?? 0);
          })
          .slice(0, 40)
      );
      setIsSearching(false);
    }, 280);

    return () => {
      isCurrentSearch = false;
      window.clearTimeout(searchTimer);
    };
  }, [deferredSearchQuery, weeks]);

  async function archivePastWeeks() {
    const { error: archiveError } = await supabase
      .from("weeks")
      .update({ archived: true })
      .lt("start_date", currentWeekStart)
      .eq("archived", false);

    if (archiveError) {
      setError(archiveError.message);
    }
  }

  async function bootstrap() {
    setError("");
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      setError(sessionError.message);
      setLoading(false);
      return;
    }

    if (!sessionData.session) {
      const { error: anonymousAuthError } = await supabase.auth.signInAnonymously();

      if (anonymousAuthError) {
        setError(
          "Anonymer Zugriff ist in Supabase noch nicht aktiviert. Bitte Anonymous Sign-Ins einschalten."
        );
        setLoading(false);
        return;
      }
    }

    setLoading(false);

    await archivePastWeeks();

    const [weeksResult, todosResult] = await Promise.all([
      supabase.from("weeks").select("*").order("start_date", { ascending: false }),
      supabase.from("todos").select("*").order("completed", { ascending: true }).order("position", { ascending: true })
    ]);

    if (weeksResult.error) {
      setError(weeksResult.error.message);
    } else {
      const loadedWeeks = weeksResult.data ?? [];
      setWeeks(loadedWeeks);

      const selectedWeek = loadedWeeks.find((week) => week.id === selectedWeekIdRef.current) ?? null;
      const needsSelectionReset = !selectedWeek || selectedWeek.archived;

      if (needsSelectionReset) {
        const initialWeek = getDefaultWeek(loadedWeeks, currentWeekStart);
        setSelectedWeekId(initialWeek?.id ?? null);
      }
    }

    if (todosResult.error) {
      setError(todosResult.error.message);
    } else {
      setTodos(todosResult.data ?? []);
      setTodoDrafts((current) => {
        const incoming = buildTodoDrafts(todosResult.data ?? []);
        const nextDrafts = { ...incoming };

        Object.keys(current).forEach((todoId) => {
          if (todoSaveTimers.current[todoId]) {
            nextDrafts[todoId] = current[todoId];
          }
        });

        return nextDrafts;
      });
    }
  }

  async function refreshPlanner() {
    setIsRefreshing(true);
    try {
      await bootstrap();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Aktualisierung fehlgeschlagen.");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function loadEntries(weekId: string | null) {
    if (!weekId) {
      setEntries([]);
      setEntryDrafts({});
      return;
    }

    const { data, error: entriesError } = await supabase
      .from("entries")
      .select("*")
      .eq("week_id", weekId);

    if (entriesError) {
      setError(entriesError.message);
      return;
    }

    setEntries(data ?? []);
    setEntriesByWeek((current) => ({
      ...current,
      [weekId]: data ?? []
    }));
    setEntryDrafts(buildEntryDrafts(data ?? []));
  }

  async function loadWeekEntriesIntoCache(weekId: string | null) {
    if (!weekId) {
      return;
    }

    const { data, error: entriesError } = await supabase
      .from("entries")
      .select("*")
      .eq("week_id", weekId);

    if (entriesError) {
      setError(entriesError.message);
      return;
    }

    setEntriesByWeek((current) => ({
      ...current,
      [weekId]: data ?? []
    }));
  }

  async function loadAppointments(weekId: string | null) {
    if (!weekId) {
      return;
    }

    const { data, error: appointmentsError } = await supabase
      .from("appointments")
      .select("*")
      .eq("week_id", weekId)
      .order("created_at", { ascending: true });

    if (appointmentsError) {
      setError(appointmentsError.message);
      return;
    }

    setAppointmentsByWeek((current) => ({
      ...current,
      [weekId]: data ?? []
    }));
  }

  async function loadWeekAppointmentsIntoCache(weekId: string | null) {
    if (!weekId) {
      return;
    }

    const { data, error: appointmentsError } = await supabase
      .from("appointments")
      .select("*")
      .eq("week_id", weekId)
      .order("created_at", { ascending: true });

    if (appointmentsError) {
      setError(appointmentsError.message);
      return;
    }

    setAppointmentsByWeek((current) => ({
      ...current,
      [weekId]: data ?? []
    }));
  }

  useEffect(() => {
    selectedWeekIdRef.current = selectedWeekId;
  }, [selectedWeekId]);

  useEffect(() => {
    bootstrap().catch((bootstrapError: Error) => {
      setError(bootstrapError.message);
      setLoading(false);
    });

    const realtimeChannel: RealtimeChannel = supabase
      .channel("planner-room")
      .on("postgres_changes", { event: "*", schema: "public", table: "weeks" }, () => {
        bootstrap();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "entries" }, () => {
        loadEntries(selectedWeekIdRef.current).catch((entryError: Error) => setError(entryError.message));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => {
        loadAppointments(selectedWeekIdRef.current).catch((appointmentsError: Error) =>
          setError(appointmentsError.message)
        );
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "todos" }, () => {
        bootstrap();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(realtimeChannel);
      Object.values(saveTimers.current).forEach((timer) => window.clearTimeout(timer));
      Object.values(todoSaveTimers.current).forEach((timer) => window.clearTimeout(timer));
      if (todoTouchHoldTimerRef.current) {
        window.clearTimeout(todoTouchHoldTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    Promise.all([
      loadEntries(selectedWeekId),
      loadAppointments(selectedWeekId)
    ]).catch((loadError: Error) => setError(loadError.message));
  }, [selectedWeekId]);

  useEffect(() => {
    [previousActiveWeek?.id ?? null, nextActiveWeek?.id ?? null].forEach((weekId) => {
      if (!weekId) {
        return;
      }

      if (!entriesByWeek[weekId]) {
        loadWeekEntriesIntoCache(weekId).catch((entryError: Error) => setError(entryError.message));
      }

      if (!appointmentsByWeek[weekId]) {
        loadWeekAppointmentsIntoCache(weekId).catch((appointmentsError: Error) =>
          setError(appointmentsError.message)
        );
      }
    });
  }, [appointmentsByWeek, entriesByWeek, nextActiveWeek?.id, previousActiveWeek?.id]);

  function handleEntryChange(day: Day, time: TimeSlot, value: string) {
    if (!activeWeek) {
      return;
    }

    const key = getEntryKey(day, time);
    setEntryDrafts((current) => ({
      ...current,
      [key]: value
    }));
    setEntriesByWeek((current) => {
      const weekEntries = current[activeWeek.id] ?? [];
      const existingEntry = weekEntries.find((entry) => entry.day === day && entry.time === time);

      if (existingEntry) {
        return {
          ...current,
          [activeWeek.id]: weekEntries.map((entry) =>
            entry.day === day && entry.time === time
              ? {
                  ...entry,
                  content: value
                }
              : entry
          )
        };
      }

      return {
        ...current,
        [activeWeek.id]: [
          ...weekEntries,
          {
            id: `draft-${activeWeek.id}-${day}-${time}`,
            week_id: activeWeek.id,
            day,
            time,
            content: value
          }
        ]
      };
    });
    setSavingKey(key);

    const currentTimer = saveTimers.current[key];
    if (currentTimer) {
      window.clearTimeout(currentTimer);
    }

    saveTimers.current[key] = window.setTimeout(async () => {
      const { error: upsertError } = await supabase.from("entries").upsert(
        {
          week_id: activeWeek.id,
          day,
          time,
          content: value
        },
        { onConflict: "week_id,day,time" }
      );

      if (upsertError) {
        setError(upsertError.message);
      } else {
        setSavingKey((current) => (current === key ? null : current));
      }
    }, 450);
  }

  async function createWeek() {
    setError("");
    const nextWeek = getNextWeekData(weeks);
    const { data, error: weekError } = await supabase
      .from("weeks")
      .insert({
        ...nextWeek,
        archived: false
      })
      .select()
      .single();

    if (weekError) {
      setError(weekError.message);
      return;
    }

    if (data) {
      setWeeks((current) => [data, ...current.filter((week) => week.id !== data.id)]);
      setSelectedWeekId(data.id);
    }
  }

  async function archiveWeek() {
    if (!activeWeek || activeWeek.archived) {
      return;
    }

    const nextSelectedWeek =
      activeWeeks.find((week) => week.id !== activeWeek.id)?.id ??
      archivedWeeks[0]?.id ??
      null;

    setWeeks((current) =>
      current.map((week) =>
        week.id === activeWeek.id
          ? {
              ...week,
              archived: true
            }
          : week
      )
    );
    setSelectedWeekId(nextSelectedWeek);

    const { error: archiveError } = await supabase
      .from("weeks")
      .update({ archived: true })
      .eq("id", activeWeek.id);

    if (archiveError) {
      setError(archiveError.message);
      bootstrap().catch((bootstrapError: Error) => setError(bootstrapError.message));
    }
  }

  async function restoreWeek(weekId: string) {
    setWeeks((current) =>
      current.map((week) =>
        week.id === weekId
          ? {
              ...week,
              archived: false
            }
          : week
      )
    );
    setSelectedWeekId(weekId);

    const { error: restoreError } = await supabase
      .from("weeks")
      .update({ archived: false })
      .eq("id", weekId);

    if (restoreError) {
      setError(restoreError.message);
      bootstrap().catch((bootstrapError: Error) => setError(bootstrapError.message));
    }
  }

  async function createTodo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!todoDraft.trim()) {
      return;
    }

    const firstPosition = visibleOpenTodos[0]?.position ?? 1000;
    const { data, error: todoError } = await supabase
      .from("todos")
      .insert({
        text: todoDraft.trim(),
        completed: false,
        assigned_to: null,
        position: firstPosition - 1000
      })
      .select()
      .single();

    if (todoError) {
      setError(todoError.message);
      return;
    }

    if (data) {
      setTodos((current) => [data, ...current.filter((todo) => todo.id !== data.id)]);
      setTodoDrafts((current) => ({
        ...current,
        [data.id]: data.text
      }));
    }

    setTodoDraft("");
  }

  async function updateTodo(todoId: string, patch: Partial<Todo>) {
    setTodos((current) =>
      current.map((todo) =>
        todo.id === todoId
          ? {
              ...todo,
              ...patch
            }
          : todo
      )
    );

    const { error: todoError } = await supabase.from("todos").update(patch).eq("id", todoId);
    if (todoError) {
      setError(todoError.message);
      bootstrap().catch((bootstrapError: Error) => setError(bootstrapError.message));
    }
  }

  function handleTodoTextChange(todoId: string, value: string) {
    setTodoDrafts((current) => ({
      ...current,
      [todoId]: value
    }));

    const currentTimer = todoSaveTimers.current[todoId];
    if (currentTimer) {
      window.clearTimeout(currentTimer);
    }

    todoSaveTimers.current[todoId] = window.setTimeout(async () => {
      const { error: todoError } = await supabase.from("todos").update({ text: value }).eq("id", todoId);

      if (todoError) {
        setError(todoError.message);
        return;
      }

      delete todoSaveTimers.current[todoId];
    }, 350);
  }

  async function persistTodoOrder(orderedIds: string[]) {
    const positions = new Map(orderedIds.map((todoId, index) => [todoId, (index + 1) * 1000]));
    setTodos((current) =>
      current.map((todo) =>
        positions.has(todo.id) ? { ...todo, position: positions.get(todo.id) ?? todo.position } : todo
      )
    );

    const results = await Promise.all(
      orderedIds.map((todoId, index) =>
        supabase.from("todos").update({ position: (index + 1) * 1000 }).eq("id", todoId)
      )
    );
    const moveError = results.find((result) => result.error)?.error;
    if (moveError) {
      setError(moveError.message);
      bootstrap().catch((bootstrapError: Error) => setError(bootstrapError.message));
    }
  }

  function beginTodoDrag(todoId: string) {
    const orderedIds = visibleOpenTodos.map((todo) => todo.id);
    draggedTodoIdRef.current = todoId;
    dragTodoOrderRef.current = orderedIds;
    setDraggedTodoId(todoId);
    setDragTodoOrder(orderedIds);
  }

  function moveDraggedTodoOver(targetTodoId: string) {
    const activeTodoId = draggedTodoIdRef.current;
    const currentOrder = dragTodoOrderRef.current;
    if (!activeTodoId || !currentOrder || activeTodoId === targetTodoId) {
      return;
    }

    const nextOrder = [...currentOrder];
    const currentIndex = nextOrder.indexOf(activeTodoId);
    const targetIndex = nextOrder.indexOf(targetTodoId);
    if (currentIndex < 0 || targetIndex < 0) {
      return;
    }

    nextOrder.splice(currentIndex, 1);
    nextOrder.splice(targetIndex, 0, activeTodoId);
    dragTodoOrderRef.current = nextOrder;
    setDragTodoOrder(nextOrder);
  }

  function finishTodoDrag() {
    if (todoTouchHoldTimerRef.current) {
      window.clearTimeout(todoTouchHoldTimerRef.current);
      todoTouchHoldTimerRef.current = null;
    }

    const finalOrder = dragTodoOrderRef.current;
    draggedTodoIdRef.current = null;
    dragTodoOrderRef.current = null;
    todoTouchStartYRef.current = null;
    setDraggedTodoId(null);
    setDragTodoOrder(null);

    if (finalOrder) {
      void persistTodoOrder(finalOrder);
    }
  }

  function autoResizeTodoField(element: HTMLTextAreaElement) {
    element.style.height = "0px";
    element.style.height = `${element.scrollHeight}px`;
  }

  function openAppointmentEditor(weekId: string, day: Day, appointment?: Appointment) {
    const editorKey = getAppointmentEditorKey(weekId, day);
    setActiveAppointmentEditor({
      weekId,
      day,
      appointmentId: appointment?.id ?? null
    });
    setAppointmentDrafts((current) => ({
      ...current,
      [editorKey]: appointment
        ? {
            title: appointment.title ?? "",
            time_label: appointment.time_label ?? ""
          }
        : (current[editorKey] ?? { ...EMPTY_APPOINTMENT_DRAFT })
    }));
  }

  function closeAppointmentEditor(weekId: string, day: Day) {
    const editorKey = getAppointmentEditorKey(weekId, day);
    setActiveAppointmentEditor((current) =>
      current?.weekId === weekId && current.day === day ? null : current
    );
    setAppointmentDrafts((current) => ({
      ...current,
      [editorKey]: { ...EMPTY_APPOINTMENT_DRAFT }
    }));
  }

  function handleAppointmentDraftChange(
    weekId: string,
    day: Day,
    field: keyof AppointmentDraft,
    value: string
  ) {
    const editorKey = getAppointmentEditorKey(weekId, day);
    setAppointmentDrafts((current) => ({
      ...current,
      [editorKey]: {
        ...(current[editorKey] ?? EMPTY_APPOINTMENT_DRAFT),
        [field]: value
      }
    }));
  }

  async function createAppointment(event: FormEvent<HTMLFormElement>, week: Week, day: Day) {
    event.preventDefault();

    const editorKey = getAppointmentEditorKey(week.id, day);
    const draft = appointmentDrafts[editorKey] ?? EMPTY_APPOINTMENT_DRAFT;
    const title = draft.title.trim();
    const timeLabel = draft.time_label.trim();

    if (!title) {
      return;
    }

    if (activeAppointmentEditor?.appointmentId) {
      const appointmentId = activeAppointmentEditor.appointmentId;
      const { error: appointmentError } = await supabase
        .from("appointments")
        .update({
          title,
          time_label: timeLabel || null
        })
        .eq("id", appointmentId);

      if (appointmentError) {
        setError(appointmentError.message);
        return;
      }

      setAppointmentsByWeek((current) => ({
        ...current,
        [week.id]: (current[week.id] ?? []).map((appointment) =>
          appointment.id === appointmentId
            ? {
                ...appointment,
                title,
                time_label: timeLabel || null
              }
            : appointment
        )
      }));

      closeAppointmentEditor(week.id, day);
      return;
    }

    const { data, error: appointmentError } = await supabase
      .from("appointments")
      .insert({
        week_id: week.id,
        day,
        title,
        time_label: timeLabel || null
      })
      .select()
      .single();

    if (appointmentError) {
      setError(appointmentError.message);
      return;
    }

    if (data) {
      setAppointmentsByWeek((current) => ({
        ...current,
        [week.id]: [...(current[week.id] ?? []), data]
      }));
    }

    closeAppointmentEditor(week.id, day);
  }

  async function deleteAppointment(weekId: string, appointmentId: string) {
    setAppointmentsByWeek((current) => ({
      ...current,
      [weekId]: (current[weekId] ?? []).filter((appointment) => appointment.id !== appointmentId)
    }));

    const { error: appointmentError } = await supabase
      .from("appointments")
      .delete()
      .eq("id", appointmentId);

    if (appointmentError) {
      setError(appointmentError.message);
      loadAppointments(weekId).catch((reloadError: Error) => setError(reloadError.message));
    }
  }

  function getWeekDrafts(week: Week | null) {
    if (!week) {
      return {};
    }

    if (week.id === selectedWeekId) {
      return entryDrafts;
    }

    return buildEntryDrafts(entriesByWeek[week.id] ?? []);
  }

  function getWeekAppointments(week: Week | null) {
    if (!week) {
      return [];
    }

    return appointmentsByWeek[week.id] ?? [];
  }

  const activeAppointmentEditorKey = activeAppointmentEditor
    ? getAppointmentEditorKey(activeAppointmentEditor.weekId, activeAppointmentEditor.day)
    : null;

  function renderWeekColumns(week: Week | null) {
    if (!week) {
      return <div className="planner-placeholder" />;
    }

    const drafts = getWeekDrafts(week);
    const appointments = getWeekAppointments(week);
    const isCurrentCalendarWeek = week.start_date === currentWeekStart;

    return (
      <div className="planning-table">
        {DAYS.map((day) => (
          (() => {
            const dayAppointments = appointments.filter((appointment) => appointment.day === day);

            return (
              <article
                className={`day-column ${isCurrentCalendarWeek && currentDayLabel === day ? "current-day" : ""}`}
                data-day={day}
                key={`${week.id}-${day}`}
              >
                <div className="day-header">
                  <strong>{getShortDayLabel(day)}</strong>
                  <span className="day-date">{getDayDateLabel(week.start_date, day)}</span>
                </div>
                {TIMES.map((time) => {
                  if (!isSlotAvailable(day, time)) {
                    return null;
                  }

                  const key = getEntryKey(day, time);
                  const isEditable = week.id === selectedWeekId;

                  return (
                    <label className="day-cell" key={`${week.id}-${key}`}>
                      <textarea
                        placeholder={isEditable ? "Eintragen..." : ""}
                        readOnly={!isEditable}
                        value={drafts[key] ?? ""}
                        onChange={(event) => handleEntryChange(day, time, event.target.value)}
                      />
                    </label>
                  );
                })}
                {week.id === selectedWeekId ? (
                  <div className="appointment-insert">
                    <button
                      className="appointment-add"
                      onClick={() => openAppointmentEditor(week.id, day)}
                      type="button"
                    >
                      +
                    </button>
                  </div>
                ) : null}
                {dayAppointments.length > 0 ? (
              <div className="appointment-stack">
                {dayAppointments.map((appointment) => (
                    <div
                      className="appointment-item"
                      data-has-time={appointment.time_label ? "true" : "false"}
                      key={appointment.id}
                    >
                      <button
                        className="appointment-open"
                        onClick={() => openAppointmentEditor(week.id, day, appointment)}
                        type="button"
                      >
                        <div className="appointment-copy">
                        {appointment.time_label ? (
                          <span className="appointment-time">{appointment.time_label}</span>
                        ) : null}
                        <span className="appointment-title-text">{appointment.title}</span>
                        </div>
                      </button>
                      {week.id === selectedWeekId ? (
                        <button
                          className="appointment-remove"
                          onClick={() => deleteAppointment(week.id, appointment.id)}
                          type="button"
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  ))}
              </div>
                ) : null}
              </article>
            );
          })()
        ))}
      </div>
    );
  }

  function selectRelativeWeek(direction: "prev" | "next") {
    if (activeWeekIndex === -1) {
      return;
    }

    const offset = direction === "next" ? 1 : -1;
    const targetWeek = activeWeeks[activeWeekIndex + offset];

    if (targetWeek) {
      setSelectedWeekId(targetWeek.id);
    }
  }

  function openSearchResult(result: PlannerSearchResult) {
    setSelectedWeekId(result.weekId);
    setSearchQuery("");
    setSearchResults([]);
    window.requestAnimationFrame(() => {
      document.querySelector(".planning-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function handlePlannerTouchStart(event: TouchEvent<HTMLElement>) {
    const touch = event.changedTouches[0];
    swipeStartXRef.current = touch?.clientX ?? null;
    swipeStartYRef.current = touch?.clientY ?? null;
    swipeLockedRef.current = null;
    setIsDragAnimating(false);
  }

  function handlePlannerTouchMove(event: TouchEvent<HTMLElement>) {
    if (swipeStartXRef.current === null || swipeStartYRef.current === null) {
      return;
    }

    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }

    const deltaX = touch.clientX - swipeStartXRef.current;
    const deltaY = touch.clientY - swipeStartYRef.current;

    if (!swipeLockedRef.current) {
      if (Math.abs(deltaX) < 12 && Math.abs(deltaY) < 12) {
        return;
      }

      swipeLockedRef.current =
        Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
    }

    if (swipeLockedRef.current === "horizontal") {
      setDragOffset(deltaX);
      event.preventDefault();
    }
  }

  function handlePlannerTouchEnd(event: TouchEvent<HTMLElement>) {
    if (swipeStartXRef.current === null || swipeStartYRef.current === null) {
      return;
    }

    const touch = event.changedTouches[0];
    const endX = touch?.clientX ?? swipeStartXRef.current;
    const endY = touch?.clientY ?? swipeStartYRef.current;
    const deltaX = endX - swipeStartXRef.current;
    const deltaY = endY - swipeStartYRef.current;
    swipeStartXRef.current = null;
    swipeStartYRef.current = null;
    const swipeMode = swipeLockedRef.current;
    swipeLockedRef.current = null;

    if (swipeMode !== "horizontal") {
      setDragOffset(0);
      return;
    }

    if (Math.abs(deltaX) <= Math.abs(deltaY)) {
      setIsDragAnimating(true);
      setDragOffset(0);
      window.setTimeout(() => setIsDragAnimating(false), 220);
      return;
    }

    const viewportWidth = plannerViewportRef.current?.offsetWidth ?? 0;
    const threshold = Math.max(50, viewportWidth * 0.18);

    if (Math.abs(deltaX) < threshold) {
      setIsDragAnimating(true);
      setDragOffset(0);
      window.setTimeout(() => setIsDragAnimating(false), 220);
      return;
    }

    if (deltaX < 0) {
      if (!nextActiveWeek || viewportWidth === 0) {
        setIsDragAnimating(true);
        setDragOffset(0);
        window.setTimeout(() => setIsDragAnimating(false), 220);
        return;
      }

      setIsDragAnimating(true);
      setDragOffset(-viewportWidth);
      window.setTimeout(() => {
        setSelectedWeekId(nextActiveWeek.id);
        setDragOffset(0);
        setIsDragAnimating(false);
      }, 220);
    } else {
      if (!previousActiveWeek || viewportWidth === 0) {
        setIsDragAnimating(true);
        setDragOffset(0);
        window.setTimeout(() => setIsDragAnimating(false), 220);
        return;
      }

      setIsDragAnimating(true);
      setDragOffset(viewportWidth);
      window.setTimeout(() => {
        setSelectedWeekId(previousActiveWeek.id);
        setDragOffset(0);
        setIsDragAnimating(false);
      }, 220);
    }
  }

  function handleWeekArrow(direction: "prev" | "next") {
    if (isDragAnimating) {
      return;
    }

    selectRelativeWeek(direction);
  }

  if (loading) {
    return (
      <main className="planner-shell">
        <section className="loading-card">
          <h1>Wochenplanung wird geladen</h1>
          <p className="muted">Daten werden geladen.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="planner-shell">
      <header className="app-header">
        <div>
          <h1 className="planner-title">Kindergarten Wochenplanung</h1>
          <p className="muted">Alle Aenderungen werden live synchronisiert.</p>
        </div>
        <div className="header-actions">
          <button
            className="status-pill live status-pill-button"
            onClick={() => refreshPlanner()}
            type="button"
          >
            {savingKey ? "Speichert..." : isRefreshing ? "Aktualisiert..." : "Live verbunden"}
          </button>
          <Link className="header-link-pill" href="/druckansicht">
            Druckansicht
          </Link>
          <button className="secondary" onClick={createWeek} type="button">
            Neue Woche erstellen
          </button>
        </div>
      </header>

      {error ? <div className="error-box">{error}</div> : null}

      <section className="planner-search" aria-label="Planung durchsuchen">
        <div className="planner-search-field">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Unterricht und Termine durchsuchen"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Unterricht oder Termine suchen..."
            type="search"
            value={searchQuery}
          />
        </div>
        {deferredSearchQuery.length >= 2 ? (
          <div className="planner-search-results">
            {isSearching ? <div className="planner-search-status">Suche...</div> : null}
            {!isSearching && searchResults.length === 0 ? (
              <div className="planner-search-status">Keine Treffer gefunden.</div>
            ) : null}
            {!isSearching
              ? searchResults.map((result) => {
                  const resultWeek = weeks.find((week) => week.id === result.weekId);
                  return (
                    <button
                      className="planner-search-result"
                      key={result.id}
                      onClick={() => openSearchResult(result)}
                      type="button"
                    >
                      <span className={`search-result-type ${result.type === "Termin" ? "appointment" : ""}`}>
                        {result.type}
                      </span>
                      <span className="search-result-copy">
                        <strong>{result.content}</strong>
                        <small>
                          {resultWeek
                            ? `KW ${resultWeek.kw} · ${getShortDayLabel(result.day)} ${getDayDateLabel(resultWeek.start_date, result.day)}${result.detail ? ` · ${result.detail}` : ""}${resultWeek.archived ? " · Archiv" : ""}`
                            : result.day}
                        </small>
                      </span>
                    </button>
                  );
                })
              : null}
          </div>
        ) : null}
      </section>

      <section className="planner-layout">
        <aside className="panel">
          <div className="section-title">
            <h2>Wochen</h2>
          </div>
          <div className="weeks-list">
            {weeks.length === 0 ? (
              <div className="empty-state">
                Noch keine Woche vorhanden. Mit dem Button oben kann direkt die naechste KW angelegt
                werden.
              </div>
            ) : (
              <>
                <select
                  className="week-select"
                  onChange={(event) => setSelectedWeekId(event.target.value || null)}
                  value={selectedWeekId ?? ""}
                >
                  <option value="">Woche waehlen</option>
                  {activeWeeks.map((week) => (
                    <option key={week.id} value={week.id}>
                      {`KW ${week.kw} - ${formatDate(week.start_date)}`}
                    </option>
                  ))}
                </select>
                {activeWeek && !activeWeek.archived ? (
                  <button className="text-toggle" onClick={archiveWeek} type="button">
                    Woche ins Archiv verschieben
                  </button>
                ) : null}
                {archivedWeeks.length > 0 ? (
                  <div className="todo-toggle-block">
                    <button
                      className="text-toggle"
                      onClick={() => setShowArchivedWeeks((current) => !current)}
                      type="button"
                    >
                      {showArchivedWeeks
                        ? `Archiv ausblenden (${archivedWeeks.length})`
                        : `Archiv anzeigen (${archivedWeeks.length})`}
                    </button>
                    {showArchivedWeeks ? (
                      <div className="weeks-list nested">
                        {archivedWeeks.map((week) => (
                          <div
                            key={week.id}
                            className={`week-card ${selectedWeekId === week.id ? "active" : ""}`}
                          >
                            <button
                              className="week-card-button"
                              onClick={() => setSelectedWeekId(week.id)}
                              type="button"
                            >
                              <strong>{`KW ${week.kw}`}</strong>
                              <span className="week-meta">Start: {formatDate(week.start_date)}</span>
                            </button>
                            <button
                              className="restore-week-button"
                              onClick={() => restoreWeek(week.id)}
                              type="button"
                            >
                              Wiederherstellen
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </aside>

        <section
          className="panel planning-panel"
          onTouchEnd={handlePlannerTouchEnd}
          onTouchMove={handlePlannerTouchMove}
          onTouchStart={handlePlannerTouchStart}
        >
          <div className="section-title">
            <div>
              <h2>{activeWeek ? `Planung fuer KW ${activeWeek.kw}` : "Planung"}</h2>
              <p className="muted">
                {activeWeek
                  ? `Wochenstart ${formatDate(activeWeek.start_date)}`
                  : "Bitte zuerst eine Woche auswaehlen oder erstellen."}
              </p>
            </div>
            {activeWeeks.length > 1 ? (
              <div className="week-nav" aria-label="Wochen wechseln">
                <button
                  className="week-nav-button"
                  disabled={activeWeekIndex <= 0}
                  onClick={() => handleWeekArrow("prev")}
                  type="button"
                >
                  ←
                </button>
                <button
                  className="week-today-button"
                  disabled={!todayWeek || todayWeek.id === selectedWeekId}
                  onClick={() => todayWeek && setSelectedWeekId(todayWeek.id)}
                  type="button"
                >
                  Heute
                </button>
                <button
                  className="week-nav-button"
                  disabled={activeWeekIndex === -1 || activeWeekIndex >= activeWeeks.length - 1}
                  onClick={() => handleWeekArrow("next")}
                  type="button"
                >
                  →
                </button>
              </div>
            ) : null}
          </div>

          {activeWeek ? (
            <div className="planner-grid" ref={plannerViewportRef}>
              <div
                className={`planning-track ${isDragAnimating ? "animating" : ""}`}
                style={{ transform: `translateX(calc(-100% + ${dragOffset}px))` }}
              >
                <div className="planning-slide">{renderWeekColumns(previousActiveWeek)}</div>
                <div className="planning-slide">{renderWeekColumns(activeWeek)}</div>
                <div className="planning-slide">{renderWeekColumns(nextActiveWeek)}</div>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              Sobald eine Woche gewaehlt ist, erscheint hier die Montag-bis-Freitag-Planung.
            </div>
          )}
        </section>

        <aside className="panel">
          <div className="section-title">
            <h2>To-dos</h2>
          </div>

          <form className="todo-create" onSubmit={createTodo}>
            <input
              type="text"
              placeholder="Neues To-do notieren..."
              value={todoDraft}
              onChange={(event) => setTodoDraft(event.target.value)}
            />
            <button type="submit">To-do hinzufuegen</button>
          </form>

          <div className="todos-list">
            {visibleOpenTodos.length === 0 && completedTodos.length === 0 ? (
              <div className="empty-state">Noch keine To-dos vorhanden.</div>
            ) : (
              <>
                {visibleOpenTodos.map((todo) => (
                  <article
                    className={`todo-item ${draggedTodoId === todo.id ? "todo-item-dragging" : ""}`}
                    data-todo-id={todo.id}
                    draggable
                    key={todo.id}
                    onDragEnd={finishTodoDrag}
                    onDragOver={(event) => {
                      event.preventDefault();
                      moveDraggedTodoOver(todo.id);
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", todo.id);
                      beginTodoDrag(todo.id);
                    }}
                    onTouchEnd={finishTodoDrag}
                    onTouchMove={(event) => {
                      const touch = event.touches[0];
                      if (!touch) {
                        return;
                      }

                      if (!draggedTodoIdRef.current) {
                        if (
                          todoTouchStartYRef.current !== null &&
                          Math.abs(touch.clientY - todoTouchStartYRef.current) > 10 &&
                          todoTouchHoldTimerRef.current
                        ) {
                          window.clearTimeout(todoTouchHoldTimerRef.current);
                          todoTouchHoldTimerRef.current = null;
                        }
                        return;
                      }

                      event.preventDefault();
                      const target = document.elementFromPoint(touch.clientX, touch.clientY);
                      const targetCard = target?.closest<HTMLElement>("[data-todo-id]");
                      if (targetCard?.dataset.todoId) {
                        moveDraggedTodoOver(targetCard.dataset.todoId);
                      }
                    }}
                    onTouchStart={(event) => {
                      const target = event.target as HTMLElement;
                      if (target.closest("textarea, input, button")) {
                        return;
                      }

                      todoTouchStartYRef.current = event.touches[0]?.clientY ?? null;
                      todoTouchHoldTimerRef.current = window.setTimeout(() => beginTodoDrag(todo.id), 420);
                    }}
                  >
                    <div className="todo-topline">
                      <input
                        type="checkbox"
                        checked={todo.completed}
                        onChange={(event) =>
                          updateTodo(todo.id, {
                            completed: event.target.checked
                          })
                        }
                      />
                      <textarea
                        className="todo-text"
                        ref={(element) => {
                          if (element) autoResizeTodoField(element);
                        }}
                        rows={1}
                        value={todoDrafts[todo.id] ?? todo.text}
                        onChange={(event) => {
                          autoResizeTodoField(event.currentTarget);
                          handleTodoTextChange(todo.id, event.target.value);
                        }}
                        onInput={(event) => autoResizeTodoField(event.currentTarget)}
                      />
                      <span className="todo-drag-handle" aria-hidden="true">⋮⋮</span>
                    </div>
                  </article>
                ))}

                {completedTodos.length > 0 ? (
                  <div className="todo-toggle-block">
                    <button
                      className="text-toggle"
                      onClick={() => setShowCompletedTodos((current) => !current)}
                      type="button"
                    >
                      {showCompletedTodos
                        ? `Erledigte To-dos ausblenden (${completedTodos.length})`
                        : `Erledigte To-dos anzeigen (${completedTodos.length})`}
                    </button>
                    {showCompletedTodos ? (
                      <div className="todos-list nested">
                        {completedTodos.map((todo) => (
                          <article className="todo-item todo-item-completed completed" key={todo.id}>
                            <div className="todo-topline">
                              <input
                                type="checkbox"
                                checked={todo.completed}
                                onChange={(event) =>
                                  updateTodo(todo.id, {
                                    completed: event.target.checked
                                  })
                                }
                              />
                              <textarea
                                className="todo-text"
                                ref={(element) => {
                                  if (element) autoResizeTodoField(element);
                                }}
                                rows={1}
                                value={todoDrafts[todo.id] ?? todo.text}
                                onChange={(event) => {
                                  autoResizeTodoField(event.currentTarget);
                                  handleTodoTextChange(todo.id, event.target.value);
                                }}
                                onInput={(event) => autoResizeTodoField(event.currentTarget)}
                              />
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </aside>
      </section>

      {activeAppointmentEditor && activeWeek?.id === activeAppointmentEditor.weekId ? (
        <div
          className="appointment-modal-backdrop"
          onClick={() => closeAppointmentEditor(activeAppointmentEditor.weekId, activeAppointmentEditor.day)}
          role="presentation"
        >
              <div
                className="appointment-modal"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
            aria-label={activeAppointmentEditor.appointmentId ? "Termin bearbeiten" : "Termin einfuegen"}
              >
              <div className="appointment-modal-header">
                <div>
                <h3>{activeAppointmentEditor.appointmentId ? "Termin bearbeiten" : "Termin einfuegen"}</h3>
                <p className="muted">
                  {getShortDayLabel(activeAppointmentEditor.day)} {getDayDateLabel(activeWeek.start_date, activeAppointmentEditor.day)}
                </p>
              </div>
              <button
                className="appointment-modal-close"
                onClick={() => closeAppointmentEditor(activeAppointmentEditor.weekId, activeAppointmentEditor.day)}
                type="button"
              >
                ×
              </button>
            </div>
            <form
              className="appointment-modal-form"
              onSubmit={(event) => createAppointment(event, activeWeek, activeAppointmentEditor.day)}
            >
              <input
                type="text"
                placeholder="Termin"
                value={appointmentDrafts[activeAppointmentEditorKey ?? ""]?.title ?? ""}
                onChange={(event) =>
                  handleAppointmentDraftChange(
                    activeAppointmentEditor.weekId,
                    activeAppointmentEditor.day,
                    "title",
                    event.target.value
                  )
                }
              />
              <input
                type="text"
                placeholder="Zeit, z. B. 14:00"
                value={appointmentDrafts[activeAppointmentEditorKey ?? ""]?.time_label ?? ""}
                onChange={(event) =>
                  handleAppointmentDraftChange(
                    activeAppointmentEditor.weekId,
                    activeAppointmentEditor.day,
                    "time_label",
                    event.target.value
                  )
                }
              />
              <div className="appointment-modal-actions">
                <button className="appointment-cancel" type="button" onClick={() => closeAppointmentEditor(activeAppointmentEditor.weekId, activeAppointmentEditor.day)}>
                  Abbrechen
                </button>
                <button className="appointment-save" type="submit">
                  {activeAppointmentEditor.appointmentId ? "Aktualisieren" : "Speichern"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
