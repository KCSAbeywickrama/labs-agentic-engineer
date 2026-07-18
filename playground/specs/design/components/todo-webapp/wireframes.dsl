// Todo Webapp — sign-in + single-user todo/list management, four screens

screen SignIn "Unauthenticated visitor is prompted to sign in before seeing any todos"
  navbar "TodoApp"
  card "Welcome to TodoApp"
    text "Sign in to view and manage your todos."
    button "Sign in" primary -> TodoList

screen TodoList "Signed-in user views todos grouped by list, with status filter"
  navbar "TodoApp | Lists | Sign out"
  row
    heading "My Todos"
    right
    search "Search todos"
    select "Filter: All"
    button "New todo" primary -> NewTodo
  tabs "All | Active | Completed"
  heading "Work"
  table "Title | Due | Status | " -> EditTodo
    row "Finish quarterly report | Fri | Open | Edit"
    row "Review PR #42 | Today | Overdue | Edit"
  heading "Personal"
  table "Title | Due | Status | " -> EditTodo
    row "Book dentist appointment | Mon | Open | Edit"
    row "Renew passport | — | Done | Edit"
  row
    heading "Lists"
    right
    button "New list" primary -> NewList
  list "Work | Personal | Unlisted"

screen NewTodo "User creates a new todo with optional description, due date, and list"
  navbar "TodoApp | Lists | Sign out"
  breadcrumb "Todos / New todo"
  heading "New Todo"
  input "Title — e.g. Finish quarterly report"
  textarea "Description (optional)"
  row
    input "Due date (optional)"
    select "List: Unlisted"
  row
    right
    button "Cancel" -> TodoList
    button "Create todo" primary -> TodoList

screen EditTodo "User edits, completes/reopens, or deletes an existing todo"
  navbar "TodoApp | Lists | Sign out"
  breadcrumb "Todos / Finish quarterly report"
  row
    heading "Finish quarterly report"
    badge "Overdue" danger
  input "Title"
  textarea "Description"
  row
    input "Due date"
    select "List: Work"
  row
    checkbox "Mark as complete"
    right
    button "Delete" danger -> TodoList
  row
    right
    button "Cancel" -> TodoList
    button "Save changes" primary -> TodoList

screen NewList "User creates a new list to organize todos"
  navbar "TodoApp | Lists | Sign out"
  breadcrumb "Lists / New list"
  heading "New List"
  input "List name — e.g. Groceries"
  row
    right
    button "Cancel" -> TodoList
    button "Create list" primary -> TodoList
