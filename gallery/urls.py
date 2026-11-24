from django.urls import path, re_path

from . import views

urlpatterns = [
    path("api/session", views.session),
    path("api/session/login", views.login),
    path("api/session/logout", views.logout),
    path("api/templates", views.templates),
    path("api/templates/<slug:slug>", views.template),
    path("api/templates/<slug:slug>/thumbnail", views.thumbnail),
    path("api/templates/<slug:slug>/<slug:kind>", views.document),
    path("api/sources/<uuid:key>.zip", views.download),
    path("local/source/<uuid:key>.zip", views.download),
    path("local/<slug:kind>/<slug:slug>", views.document),
    path("local-library.json", views.inventory),
    path("builds/<uuid:key>/", views.preview),
    path("preview/<str:token>/<path:name>", views.preview_asset),
    re_path(
        r"^(?P<name>(?:images|assets|fonts|audio|models)/.+)$",
        views.preview_absolute_asset,
    ),
    path("_deployment", views.revision),
    path(
        "ui/assets/<path:name>",
        lambda request, name: views.ui(request, "assets/" + name),
    ),
    path("", views.ui),
    path("templates", views.ui),
    path("templates/", views.ui),
    re_path(r"^(?:zh/)?templates/(?P<slug>[\w-]+)/?$", views.ui),
    path("zh", views.ui),
    path("zh/templates", views.ui),
]
