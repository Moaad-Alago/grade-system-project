const API = "https://grade-system-backend-78mv.onrender.com";

/* ---------- Common Elements ---------- */
const courseSelect = document.getElementById("courseSelect");
const gradeInputs = document.getElementById("gradeInputs");
const form = document.getElementById("gradeForm");
const resultBox = document.getElementById("result");

const studentNameInput = document.getElementById("studentName");
const studentIdInput = document.getElementById("studentId");

const studentsBody = document.getElementById("studentsBody");
const searchIdInput = document.getElementById("searchIdInput");
const statusFilter = document.getElementById("statusFilter");
const searchBtn = document.getElementById("searchBtn");
const resetBtn = document.getElementById("resetBtn");

/* ---------- State ---------- */
let coursesCache = {};

/* ---------- Helpers ---------- */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getCourseByDisplayName(courseName) {
  const lower = String(courseName || "").trim().toLowerCase();
  return Object.values(coursesCache).find(
    (c) => String(c.name).trim().toLowerCase() === lower
  );
}

/* ---------- Load Courses (for index page + edit dialogs) ---------- */
async function loadCourses() {
  try {
    const res = await fetch(`${API}/api/courses`);
    const courses = await res.json();

    if (!res.ok) throw new Error(courses.error || "Failed to load courses");

    coursesCache = courses;

    // إذا مش في صفحة index، ما نكمل تعبئة الـ select
    if (!courseSelect) return;

    courseSelect.innerHTML = "";

    for (let key in courses) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = courses[key].name;
      courseSelect.appendChild(option);
    }

    updateInputs(courses, courseSelect.value);

    // مهم: لا نكرر listener كل مرة
    if (!courseSelect.dataset.bound) {
      courseSelect.addEventListener("change", () => {
        updateInputs(coursesCache, courseSelect.value);
      });
      courseSelect.dataset.bound = "true";
    }
  } catch (err) {
    console.error("loadCourses error:", err);
    if (resultBox) {
      resultBox.textContent = "Network error. Check backend server.";
      resultBox.style.color = "red";
    }
  }
}

/* ---------- Create inputs based on grading system ---------- */
function updateInputs(courses, selected) {
  if (!gradeInputs || !courses || !courses[selected]) return;

  gradeInputs.innerHTML = "";

  const components = courses[selected].components;

  for (let part in components) {
    const input = document.createElement("input");
    input.type = "number";
    input.placeholder = `${part} grade (${components[part]}%)`;
    input.id = part;
    input.required = true;
    input.min = "0";
    input.max = "100";
    input.step = "0.01";
    gradeInputs.appendChild(input);
  }
}

/* ---------- Submit grade form ---------- */
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    try {
      const data = {
        studentName: studentNameInput ? studentNameInput.value.trim() : "",
        studentId: studentIdInput ? studentIdInput.value.trim() : "",
        course: courseSelect ? courseSelect.value : ""
      };

      const inputs = gradeInputs ? gradeInputs.querySelectorAll("input") : [];
      inputs.forEach(i => (data[i.id] = i.value));

      const res = await fetch(`${API}/api/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      const response = await res.json();

      if (!res.ok || response.error) {
        throw new Error(response.error || "Failed to save grade");
      }

      resultBox.textContent =
        `Final grade: ${response.student.grade} | ${response.student.status}`;
      resultBox.style.color = response.student.status === "Passed" ? "green" : "red";

      // اختياري: تنظيف العلامات فقط
      if (gradeInputs) {
        gradeInputs.querySelectorAll("input").forEach(i => (i.value = ""));
      }
    } catch (err) {
      console.error("submit error:", err);
      if (resultBox) {
        resultBox.textContent = err.message;
        resultBox.style.color = "red";
      } else {
        alert(err.message);
      }
    }
  });
}

/* ---------- Build students API URL (search/filter) ---------- */
function buildStudentsUrl() {
  const params = new URLSearchParams();

  if (searchIdInput && searchIdInput.value.trim()) {
    params.set("id", searchIdInput.value.trim());
  }

  if (statusFilter && statusFilter.value) {
    params.set("status", statusFilter.value);
  }

  const query = params.toString();
  return `${API}/api/students${query ? `?${query}` : ""}`;
}

/* ---------- Load students ---------- */
async function loadStudents() {
  if (!studentsBody) return;

  try {
    const res = await fetch(buildStudentsUrl());
    const students = await res.json();

    if (!res.ok) {
      throw new Error(students.error || "Failed to load students");
    }

    studentsBody.innerHTML = "";

    if (!Array.isArray(students) || students.length === 0) {
      studentsBody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align:center; color:#64748b;">No students found.</td>
        </tr>
      `;
      return;
    }

    students.sort((a, b) => String(a.id).localeCompare(String(b.id)));

    students.forEach((s, index) => {
      const coursesHTML = (s.courses || []).map((c, i, arr) => `
        <div style="
          margin-bottom:${i < arr.length - 1 ? "10px" : "0"};
          padding-bottom:${i < arr.length - 1 ? "8px" : "0"};
          border-bottom:${i < arr.length - 1 ? "1px dashed #cbd5e1" : "none"};
        ">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
            <div>
              <strong>${escapeHtml(c.courseName)}</strong> :
              ${escapeHtml(String(c.grade))} —
              <span style="color:${c.status === "Passed" ? "green" : "red"}; font-weight:600;">
                ${escapeHtml(c.status)}
              </span>
            </div>

            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button
                type="button"
                onclick="editCourseGrade('${escapeHtml(String(s.id))}', '${encodeURIComponent(c.courseName)}')"
                class="btn-small btn-edit"
              >
                Edit Grade
              </button>

              <button
                type="button"
                onclick="deleteCourse('${escapeHtml(String(s.id))}', '${encodeURIComponent(c.courseName)}')"
                class="btn-small btn-delete-course"
              >
                Delete Course
              </button>
            </div>
          </div>
        </div>
      `).join("");

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${index + 1}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>
          ${escapeHtml(String(s.id))}
          <div style="margin-top:8px;">
            <button
              type="button"
              onclick="deleteStudent('${escapeHtml(String(s.id))}')"
              class="btn-small btn-delete-student"
            >
              Delete Student
            </button>
          </div>
        </td>
        <td>${coursesHTML}</td>
      `;

      studentsBody.appendChild(tr);
    });
  } catch (err) {
    console.error("loadStudents error:", err);
    studentsBody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align:center; color:red;">${escapeHtml(err.message)}</td>
      </tr>
    `;
  }
}

/* ---------- Delete student ---------- */
async function deleteStudent(studentId) {
  if (!confirm("Delete this student?")) return;

  try {
    const res = await fetch(`${API}/api/students/${encodeURIComponent(studentId)}`, {
      method: "DELETE"
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Delete failed");

    await loadStudents();
  } catch (err) {
    console.error("deleteStudent error:", err);
    alert(err.message);
  }
}

/* ---------- Delete course for a student ---------- */
async function deleteCourse(studentId, encodedCourseName) {
  if (!confirm("Delete this course for the student?")) return;

  try {
    const res = await fetch(
      `${API}/api/students/${encodeURIComponent(studentId)}/courses/${encodedCourseName}`,
      { method: "DELETE" }
    );

    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Delete failed");

    await loadStudents();
  } catch (err) {
    console.error("deleteCourse error:", err);
    alert(err.message);
  }
}

/* ---------- Edit grade (PUT update) ---------- */
async function editCourseGrade(studentId, encodedCourseName) {
  try {
    const courseName = decodeURIComponent(encodedCourseName);
    const courseDef = getCourseByDisplayName(courseName);

    if (!courseDef) {
      alert("Cannot edit this course: course definition not found.");
      return;
    }

    const payload = {};

    for (const component of Object.keys(courseDef.components)) {
      const value = prompt(`Enter new ${component} grade for ${courseName} (${courseDef.components[component]}%)`);

      // إذا المستخدم كبس Cancel
      if (value === null) return;

      const num = Number(value);
      if (Number.isNaN(num) || num < 0 || num > 100) {
        alert(`${component} grade must be between 0 and 100`);
        return;
      }

      payload[component] = num;
    }

    const res = await fetch(
      `${API}/api/students/${encodeURIComponent(studentId)}/courses/${encodedCourseName}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Update failed");

    await loadStudents();
  } catch (err) {
    console.error("editCourseGrade error:", err);
    alert(err.message);
  }
}

/* ---------- Search / Filter events (students page only) ---------- */
if (searchBtn) {
  searchBtn.addEventListener("click", () => {
    loadStudents();
  });
}

if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    if (searchIdInput) searchIdInput.value = "";
    if (statusFilter) statusFilter.value = "";
    loadStudents();
  });
}

if (searchIdInput) {
  searchIdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      loadStudents();
    }
  });
}

if (statusFilter) {
  statusFilter.addEventListener("change", () => {
    loadStudents();
  });
}

/* ---------- Floating background ---------- */
const floatingBg = document.querySelector('.floating-bg');
if (floatingBg) {
  const symbols = ['X', 'O', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

  for (let i = 0; i < 24; i++) {
    const item = document.createElement('span');
    item.className = 'floating-symbol';

    item.textContent = symbols[Math.floor(Math.random() * symbols.length)];

    item.style.left = Math.random() * 100 + 'vw';
    item.style.top = Math.random() * -20 + 'vh';
    item.style.fontSize = (5 + Math.random() * 7) + 'rem';
    item.style.opacity = 0.03 + Math.random() * 0.07;

    const duration = 60 + Math.random() * 90;
    item.style.animation = `floatUp ${duration}s linear infinite`;
    item.style.animationDelay = `-${Math.random() * 60}s`;

    floatingBg.appendChild(item);
  }
}

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", async () => {
  // مهم: نحمّل الكورسات دائمًا (حتى بصفحة الطلاب، عشان Edit Grade يعرف مكونات الكورس)
  await loadCourses();
  await loadStudents();
});