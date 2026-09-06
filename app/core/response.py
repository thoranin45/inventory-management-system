from app.core.quantity import encode_quantities


def success_response(
    message: str,
    data=None
):
    return {
        "success": True,
        "message": message,
        "data": encode_quantities(data)
    }
